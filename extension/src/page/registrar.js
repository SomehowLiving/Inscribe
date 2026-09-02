/**
 * AgentForge — registrar + executor (MAIN world).
 *
 * Registers synthesized candidates as real WebMCP tools on this document, and
 * executes them against the live DOM using the selectors captured at scan
 * time (so call-time behaviour is deterministic, not a second guess).
 *
 * Trust model, mirroring the spec's `toolautosubmit`:
 *   - `declared` tools (author wrote toolname) may act immediately.
 *   - `inferred` tools ALWAYS ask the human first, via the overlay. If no
 *     confirmation arrives, the tool refuses rather than acting.
 */
(function () {
  'use strict';

  const PAGE = 'agentforge-page';
  const EXT = 'agentforge-ext';

  const state = {
    candidates: [],
    controller: null,
    pending: new Map(),
    seq: 0,
  };

  function post(type, payload) {
    window.postMessage({ source: PAGE, type, payload }, window.location.origin);
  }

  function requestConfirmation(candidate, args) {
    const id = `cf_${++state.seq}`;
    return new Promise((resolve) => {
      state.pending.set(id, resolve);
      post('confirm-request', {
        id,
        name: candidate.name,
        kind: candidate.kind,
        confidence: candidate.confidence,
        selector: candidate.selector,
        args,
      });
      // Fail closed: no answer means no action.
      setTimeout(() => {
        if (state.pending.has(id)) {
          state.pending.delete(id);
          resolve(false);
        }
      }, 60000);
    });
  }

  function setValue(el, value) {
    const proto =
      el.localName === 'select'
        ? HTMLSelectElement.prototype
        : el.localName === 'textarea'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    // Use the native setter so React/Vue controlled inputs actually update.
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillField(root, field, value) {
    const el = root.querySelector(field.selector) || document.querySelector(field.selector);
    if (!el) return { field: field.name, ok: false, reason: 'element not found' };

    const kind = (field.kind || '').toLowerCase();
    if (kind === 'checkbox') {
      if (Boolean(el.checked) !== Boolean(value)) el.click();
      return { field: field.name, ok: true };
    }
    if (kind === 'radio') {
      const chosen =
        document.querySelector(`input[type=radio][name="${CSS.escape(field.name)}"][value="${CSS.escape(String(value))}"]`);
      if (!chosen) return { field: field.name, ok: false, reason: 'no radio with that value' };
      chosen.click();
      return { field: field.name, ok: true };
    }
    el.focus();
    setValue(el, Array.isArray(value) ? value.join(',') : String(value));
    return { field: field.name, ok: true };
  }

  async function executeCandidate(candidate, args = {}) {
    if (candidate.trust !== 'declared') {
      const approved = await requestConfirmation(candidate, args);
      if (!approved) {
        return {
          content: [{ type: 'text', text: `Refused: "${candidate.name}" was inferred from the page, and the human did not confirm it.` }],
          isError: true,
        };
      }
    }

    if (candidate.kind === 'action') {
      const el = document.querySelector(candidate.selector);
      if (!el) {
        return { content: [{ type: 'text', text: `Element no longer present: ${candidate.selector}` }], isError: true };
      }
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.click();
      post('log', { name: candidate.name, detail: 'clicked' });
      return { content: [{ type: 'text', text: `Activated "${candidate.name}".` }] };
    }

    // form
    const form = document.querySelector(candidate.selector);
    if (!form) {
      return { content: [{ type: 'text', text: `Form no longer present: ${candidate.selector}` }], isError: true };
    }

    const results = [];
    for (const field of candidate.fields) {
      if (!(field.name in args)) continue;
      results.push(fillField(form, field, args[field.name]));
    }

    const failed = results.filter((r) => !r.ok);
    const filled = results.filter((r) => r.ok).map((r) => r.field);

    // Only submit when the author explicitly allowed it. Otherwise focus the
    // submit control and hand the decision back to the human, exactly as the
    // declarative spec does when `toolautosubmit` is absent.
    let submitted = false;
    const submit = form.querySelector('[type=submit], button:not([type=button]):not([type=reset])');
    if (candidate.autosubmit) {
      if (submit) submit.click();
      else form.requestSubmit ? form.requestSubmit() : form.submit();
      submitted = true;
    } else if (submit) {
      submit.scrollIntoView({ block: 'center', behavior: 'instant' });
      submit.focus();
    }

    post('log', { name: candidate.name, detail: `filled ${filled.length} field(s)${submitted ? ', submitted' : ', awaiting human submit'}` });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            filled,
            failed,
            submitted,
            note: submitted
              ? 'Form was submitted (author opted in via toolautosubmit).'
              : 'Fields filled. Submit control focused — the human completes the action.',
          }),
        },
      ],
      ...(failed.length ? { isError: false } : {}),
    };
  }

  async function register() {
    const forge = window.__agentforge;
    if (!forge) return;

    // Abort the previous generation; spec unregistration is signal-based.
    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    const { signal } = state.controller;

    const { candidates, stats, url, title } = window.__agentforgeSynthesize.scan();
    state.candidates = candidates;

    for (const c of candidates) {
      try {
        await forge.host.registerTool(
          {
            name: c.name,
            description: c.description,
            inputSchema: c.inputSchema,
            annotations: {
              readOnlyHint: false,
              untrustedContentHint: true, // page-derived; treat output with care
            },
            execute: (args) => executeCandidate(c, args),
          },
          { signal }
        );
      } catch (err) {
        post('log', { name: c.name, detail: `register failed: ${err.message}` });
      }
    }

    // Also surface tools the SITE declared natively — always preferred.
    let siteTools = [];
    try {
      if (forge.usingNative) {
        siteTools = (await forge.host.getTools()).map((t) => ({
          name: t.name,
          description: t.description,
          trust: 'declared',
          kind: 'native',
          confidence: 1,
        }));
      }
    } catch {
      /* getTools may reject if permissions policy denies */
    }

    post('tools', {
      url,
      title,
      usingNative: forge.usingNative,
      stats,
      siteTools,
      tools: candidates.map((c) => ({
        name: c.name,
        description: c.description,
        kind: c.kind,
        trust: c.trust,
        confidence: c.confidence,
        evidence: c.evidence,
        sensitive: c.sensitive,
        autosubmit: c.autosubmit,
        fieldCount: c.fields.length,
        inputSchema: c.inputSchema,
      })),
    });
  }

  let debounce;
  function scheduleRescan() {
    clearTimeout(debounce);
    debounce = setTimeout(register, 600);
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== EXT) return;

    if (data.type === 'scan') {
      scheduleRescan();
      return;
    }
    if (data.type === 'confirm-response') {
      const resolve = state.pending.get(data.payload.id);
      if (resolve) {
        state.pending.delete(data.payload.id);
        resolve(Boolean(data.payload.approved));
      }
      return;
    }
    if (data.type === 'execute') {
      const { name, args, callId } = data.payload;
      const candidate = state.candidates.find((c) => c.name === name);
      let result;
      if (!candidate) {
        result = { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      } else {
        try {
          result = await executeCandidate(candidate, args || {});
        } catch (err) {
          result = { content: [{ type: 'text', text: `Tool threw: ${err.message}` }], isError: true };
        }
      }
      post('execute-result', { callId, name, result });
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleRescan, { once: true });
  } else {
    scheduleRescan();
  }

  const mo = new MutationObserver(scheduleRescan);
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
