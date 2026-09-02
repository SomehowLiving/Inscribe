// Vercel Node.js Function (ESM):
//   GET  -> list of usable models (id/label/provider), filtered to whichever
//           providers actually have credentials configured on this deployment.
//   POST { messages, tools, model? } -> one step of a real, LLM-driven agent
//           loop. The model call happens here; tool EXECUTION happens back
//           on the client, against the real VFS/UI — this endpoint never
//           touches the VFS, it only decides what to call next.
//
// `tools` are registered with generateText WITHOUT an `execute` function, so
// the SDK returns the tool-call requests instead of running them.

import { generateText, dynamicTool, jsonSchema } from 'ai';
import { groq } from '@ai-sdk/groq';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { google } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const nvidia = createOpenAICompatible({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  name: 'nvidia',
  apiKey: process.env.NVIDIA_API_KEY,
});

// Every model here was checked live against its provider's own model
// catalog (not guessed) and confirmed to support tool calling. All of these
// are direct provider integrations — billed to their own API keys, with no
// dependency on Vercel AI Gateway at all.
const MODEL_REGISTRY = [
  {
    id: 'groq/gpt-oss-120b',
    label: 'Groq — GPT-OSS 120B',
    available: () => Boolean(process.env.GROQ_API_KEY),
    resolve: () => groq('openai/gpt-oss-120b'),
  },
  {
    id: 'openrouter/gpt-5-mini',
    label: 'OpenRouter — GPT-5 Mini',
    available: () => Boolean(process.env.OPENROUTER_API_KEY),
    resolve: () => openrouter('openai/gpt-5-mini'),
  },
  {
    id: 'openrouter/claude-sonnet-4.5',
    label: 'OpenRouter — Claude Sonnet 4.5',
    available: () => Boolean(process.env.OPENROUTER_API_KEY),
    resolve: () => openrouter('anthropic/claude-sonnet-4.5'),
  },
  {
    id: 'openrouter/gemini-2.5-flash',
    label: 'OpenRouter — Gemini 2.5 Flash',
    available: () => Boolean(process.env.OPENROUTER_API_KEY),
    resolve: () => openrouter('google/gemini-2.5-flash'),
  },
  {
    id: 'openrouter/deepseek-chat-v3.1',
    label: 'OpenRouter — DeepSeek Chat v3.1',
    available: () => Boolean(process.env.OPENROUTER_API_KEY),
    resolve: () => openrouter('deepseek/deepseek-chat-v3.1'),
  },
  {
    id: 'google/gemini-3.5-flash',
    label: 'Google — Gemini 3.5 Flash',
    available: () => Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
    resolve: () => google('gemini-3.5-flash'),
  },
  {
    id: 'google/gemini-3-flash-preview',
    label: 'Google — Gemini 3 Flash (preview)',
    available: () => Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
    resolve: () => google('gemini-3-flash-preview'),
  },
  {
    id: 'nvidia/llama-3.2-11b-vision-instruct',
    label: 'NVIDIA NIM — Llama 3.2 11B Vision',
    available: () => Boolean(process.env.NVIDIA_API_KEY),
    resolve: () => nvidia.chatModel('meta/llama-3.2-11b-vision-instruct'),
  },
];

const MAX_MESSAGES = 60;
const MAX_TOOLS = 30;

const SYSTEM_PROMPT = `You are the AgentForge Studio agent — an AI that builds \
things by calling WebMCP tools exposed by the IDE you're running inside. You \
have no other way to act: every file write, preview refresh, or deploy \
happens by calling a forge.* tool. Work in small, verifiable steps: write a \
file, refresh the preview, and keep going. Prefer forge.chat.send to narrate \
what you're doing and to explain any decision the human should know about \
(e.g. before deploying, or if you're blocked). When the task is complete, \
stop calling tools and reply with a short plain-text summary of what you \
built.`;

function availableModels() {
  return MODEL_REGISTRY.filter((m) => m.available());
}

// Some backends (confirmed: NVIDIA NIM) reject conversation HISTORY that
// contains an assistant turn with more than one tool-call — even though
// they'll happily generate one, and even with parallel_tool_calls:false
// (that flag turned out to be a no-op there; verified live, not assumed).
// Rather than trust each provider to behave, enforce single-tool-call-per-turn
// ourselves: if the model asked for more than one, keep only the first and
// drop the rest from both the returned tool calls and the response messages
// we hand back to the client for its next turn. The model gets to ask for
// the dropped ones again next step — nothing is silently lost, just serialized.
function limitToSingleToolCall(responseMessages, toolCalls) {
  if (toolCalls.length <= 1) return { responseMessages, toolCalls };

  const keepId = toolCalls[0].toolCallId;
  const filtered = responseMessages.map((msg) => {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return msg;
    return {
      ...msg,
      content: msg.content.filter((part) => part.type !== 'tool-call' || part.toolCallId === keepId),
    };
  });

  return { responseMessages: filtered, toolCalls: [toolCalls[0]] };
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json({
      models: availableModels().map(({ id, label }) => ({ id, label })),
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
    return;
  }

  const body = req.body || {};
  const { messages, tools: toolDefs, model: modelId } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'bad_request', message: '`messages` must be a non-empty array.' });
    return;
  }
  if (messages.length > MAX_MESSAGES) {
    res.status(400).json({ error: 'bad_request', message: `Too many messages (max ${MAX_MESSAGES}).` });
    return;
  }
  if (!toolDefs || typeof toolDefs !== 'object' || Array.isArray(toolDefs)) {
    res.status(400).json({ error: 'bad_request', message: '`tools` must be an object of {name: {description, inputSchema}}.' });
    return;
  }
  const toolEntries = Object.entries(toolDefs);
  if (toolEntries.length > MAX_TOOLS) {
    res.status(400).json({ error: 'bad_request', message: `Too many tools (max ${MAX_TOOLS}).` });
    return;
  }

  const usable = availableModels();
  const chosen = (modelId && usable.find((m) => m.id === modelId)) || usable[0];
  if (!chosen) {
    res.status(501).json({ error: 'not_configured', message: 'No model provider is configured on this deployment.' });
    return;
  }

  const tools = {};
  for (const [name, def] of toolEntries) {
    tools[name] = dynamicTool({
      description: (def && def.description) || '',
      inputSchema: jsonSchema((def && def.inputSchema) || { type: 'object', properties: {} }),
      // No execute — the client owns real execution against the VFS/UI.
    });
  }

  try {
    const result = await generateText({
      model: chosen.resolve(),
      system: SYSTEM_PROMPT,
      messages,
      tools,
      maxOutputTokens: 2048,
    });

    const rawToolCalls = result.toolCalls.map((c) => ({
      toolCallId: c.toolCallId,
      toolName: c.toolName,
      input: c.input,
    }));
    const { responseMessages, toolCalls } = limitToSingleToolCall(result.responseMessages, rawToolCalls);

    res.status(200).json({
      model: chosen.id,
      responseMessages,
      finishReason: result.finishReason,
      text: result.text,
      toolCalls,
    });
  } catch (err) {
    res.status(502).json({ error: 'model_error', message: err.message });
  }
}
