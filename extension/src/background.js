/**
 * Inscribe — background service worker.
 *
 * Holds per-tab tool registries and runs the agent loop. The model call is
 * delegated to Inscribe's existing /api/agent endpoint, which already
 * does provider-agnostic tool calling across Groq / OpenRouter / Google /
 * NVIDIA — so the extension inherits every model without shipping keys.
 *
 * MV3 service workers are terminated when idle, so nothing durable lives in a
 * module-scope variable alone: tool state is keyed by tab and rebuilt from the
 * page on demand (the relay re-sends on every scan).
 */

const AGENT_ENDPOINT = 'https://studio-bay-omega.vercel.app/api/agent';
const MAX_STEPS = 12;

const ports = new Map(); // tabId -> Port
const tools = new Map(); // tabId -> { tools, siteTools, url, title }
const waiters = new Map(); // callId -> resolve

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'inscribe-relay') return;
  const tabId = port.sender && port.sender.tab && port.sender.tab.id;
  if (tabId == null) return;

  ports.set(tabId, port);

  port.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'tools') {
      tools.set(tabId, {
        tools: msg.payload.tools || [],
        siteTools: msg.payload.siteTools || [],
        cosmeticTools: msg.payload.cosmeticTools || [],
        url: msg.payload.url,
        title: msg.payload.title,
      });
    }
    if (msg.type === 'execute-result') {
      const resolve = waiters.get(msg.payload.callId);
      if (resolve) {
        waiters.delete(msg.payload.callId);
        resolve(msg.payload.result);
      }
    }
  });

  port.onDisconnect.addListener(() => {
    ports.delete(tabId);
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'ISOLATED',
    func: () => window.__inscribeOverlay && window.__inscribeOverlay.toggle(),
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-overlay') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'ISOLATED',
    func: () => window.__inscribeOverlay && window.__inscribeOverlay.toggle(),
  });
});

function progress(tabId, detail, name) {
  const port = ports.get(tabId);
  if (port) {
    try {
      port.postMessage({ type: 'agent-progress', payload: { name: name || 'agent', detail } });
    } catch { /* port closed mid-run */ }
  }
}

async function getModels() {
  try {
    const resp = await fetch(AGENT_ENDPOINT, { method: 'GET' });
    const data = await resp.json();
    return data.models || [];
  } catch {
    return [];
  }
}

function callTool(tabId, name, args) {
  const port = ports.get(tabId);
  if (!port) return Promise.resolve({ content: [{ type: 'text', text: 'Page relay not connected.' }], isError: true });
  const callId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    waiters.set(callId, resolve);
    port.postMessage({ type: 'execute', payload: { name, args, callId } });
    setTimeout(() => {
      if (waiters.has(callId)) {
        waiters.delete(callId);
        resolve({ content: [{ type: 'text', text: 'Tool call timed out.' }], isError: true });
      }
    }, 90000);
  });
}

/**
 * One agent run against the live page. Tool schemas come from whatever the
 * page currently exposes — declared first, synthesized second.
 */
async function runAgent(tabId, goal, model) {
  const entry = tools.get(tabId);
  if (!entry || (!entry.tools.length && !entry.siteTools.length && !(entry.cosmeticTools || []).length)) {
    return { ok: false, error: 'No tools available on this page yet — try Re-scan.' };
  }

  const schemas = {};
  // Cosmetic tools first — describing a look is the common case.
  for (const t of (entry.cosmeticTools || [])) {
    schemas[t.name] = { description: t.description, inputSchema: t.inputSchema || { type: 'object', properties: {} } };
  }
  for (const t of entry.tools) {
    schemas[t.name] = { description: t.description, inputSchema: t.inputSchema || { type: 'object', properties: {} } };
  }

  const messages = [
    {
      role: 'user',
      content:
        `You are operating the web page "${entry.title}" (${entry.url}) through WebMCP tools.\n` +
        `inscribe.ui.* tools change how the page looks for this user — call inscribe.ui.targets ` +
        `first to learn what parts you can name. They apply instantly and are undoable.\n` +
        `Tools starting "form_" fill a form and "click_" activates a control; those change real ` +
        `state and need human confirmation.\n` +
        `Anything inferred from markup requires human confirmation, which may be declined — ` +
        `if a call is refused, stop and explain rather than retrying.\n\nTask: ${goal}`,
    },
  ];

  const transcript = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    progress(tabId, `thinking (step ${step + 1}/${MAX_STEPS})`);

    let data;
    try {
      const resp = await fetch(AGENT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, tools: schemas, model }),
      });
      data = await resp.json();
      if (!resp.ok) {
        progress(tabId, `error: ${data.message || resp.status}`);
        return { ok: false, error: data.message || `HTTP ${resp.status}`, transcript };
      }
    } catch (err) {
      progress(tabId, `network error: ${err.message}`);
      return { ok: false, error: err.message, transcript };
    }

    messages.push(...(data.responseMessages || []));

    if (!data.toolCalls || !data.toolCalls.length) {
      progress(tabId, 'done');
      return { ok: true, text: data.text || '', transcript };
    }

    const parts = [];
    for (const call of data.toolCalls) {
      transcript.push({ tool: call.toolName, args: call.input });
      progress(tabId, `calling ${JSON.stringify(call.input).slice(0, 80)}`, call.toolName);
      const result = await callTool(tabId, call.toolName, call.input);
      parts.push({
        type: 'tool-result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { type: 'json', value: result },
      });
    }
    messages.push({ role: 'tool', content: parts });
  }

  progress(tabId, `stopped at step limit (${MAX_STEPS})`);
  return { ok: false, error: `Stopped after ${MAX_STEPS} steps.`, transcript };
}

// Inspection surface for the worker's own DevTools console (and for automated
// tests). This lives inside the extension's worker context — page scripts have
// no path to it.
self.__inscribe = { runAgent, getModels, callTool, tools, ports };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'GET_STATE') {
    const tabId = msg.tabId ?? (sender.tab && sender.tab.id);
    sendResponse(tools.get(tabId) || { tools: [], siteTools: [] });
    return true;
  }

  if (msg.type === 'GET_MODELS') {
    getModels().then((models) => sendResponse({ models }));
    return true;
  }

  if (msg.type === 'RUN_AGENT') {
    const tabId = msg.tabId ?? (sender.tab && sender.tab.id);
    runAgent(tabId, msg.goal, msg.model).then(sendResponse);
    return true; // async
  }

  if (msg.type === 'RESCAN') {
    const tabId = msg.tabId ?? (sender.tab && sender.tab.id);
    const port = ports.get(tabId);
    if (port) port.postMessage({ type: 'scan' });
    sendResponse({ ok: true });
    return true;
  }
});
