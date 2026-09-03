/**
 * Inscribe — registrar + executor (MAIN world).
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

  const PAGE = 'inscribe-page';
  const EXT = 'inscribe-ext';

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

  /**
   * Tier one: cosmetic tools. These apply immediately with no confirmation —
   * a restyle is reversible and undoable, and prompting for every "make it
   * darker" would make the product unusable. Tier two (forms, clicks) still
   * goes through requestConfirmation below.
   */
  function tinkerTools() {
    const T = () => window.__inscribeTinker;
    const targetProp = {
      type: 'string',
      description: 'A target name from inscribe.ui.targets, a landmark word like "header"/"sidebar"/"page", or a CSS selector.',
    };
    return [
      {
        name: 'inscribe.ui.targets',
        description: 'List the parts of this page that can be restyled, hidden, or retitled. Call this first to learn what names are available.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: () => T().catalog(),
      },
      {
        name: 'inscribe.ui.theme',
        description: 'Apply a whole-page theme: "dark", "sepia", or "none" to remove it. Prefer this over restyling backgrounds by hand — it recolours the rendered page, so it works even when the site paints its own backgrounds on inner containers.',
        inputSchema: {
          type: 'object',
          properties: { mode: { type: 'string', enum: ['dark', 'sepia', 'none'] } },
          required: ['mode'],
        },
        run: (a) => T().theme(a.mode),
      },
      {
        name: 'inscribe.ui.restyle',
        description: 'Change the appearance of part of the page. Pass CSS as an object of property/value pairs, e.g. {"background":"#111","color":"#eee","font-size":"18px"}. Applies immediately and persists for this site.',
        inputSchema: {
          type: 'object',
          properties: {
            target: targetProp,
            css: { type: 'object', description: 'CSS property/value pairs.' },
            deep: {
              type: 'boolean',
              description: 'Also apply to everything inside the target. Needed for colours on real sites, where inner containers paint their own backgrounds.',
            },
          },
          required: ['target', 'css'],
        },
        run: (a) => T().restyle(a.target, a.css, a.deep),
      },
      {
        name: 'inscribe.ui.hide',
        description: 'Hide part of the page from view (the "zap" action). Reversible with inscribe.ui.show or undo.',
        inputSchema: { type: 'object', properties: { target: targetProp }, required: ['target'] },
        run: (a) => T().hide(a.target),
      },
      {
        name: 'inscribe.ui.show',
        description: 'Un-hide something previously hidden.',
        inputSchema: { type: 'object', properties: { target: targetProp }, required: ['target'] },
        run: (a) => T().show(a.target),
      },
      {
        name: 'inscribe.ui.setText',
        description: 'Replace the visible text of an element. Affects only your view of the page.',
        inputSchema: {
          type: 'object',
          properties: { target: targetProp, text: { type: 'string' } },
          required: ['target', 'text'],
        },
        run: (a) => T().setText(a.target, a.text),
      },
      {
        name: 'inscribe.ui.undo',
        description: 'Undo the last appearance change.',
        inputSchema: { type: 'object', properties: {} },
        run: () => T().undo(),
      },
      {
        name: 'inscribe.ui.reset',
        description: 'Discard every appearance change made to this site and restore it to normal.',
        inputSchema: { type: 'object', properties: {} },
        run: () => T().reset(),
      },
    ];
  }

  async function register() {
    const inscribe = window.__inscribe;
    if (!inscribe) return;

    // Abort the previous generation; spec unregistration is signal-based.
    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    const { signal } = state.controller;

    const { candidates, stats, url, title } = window.__inscribeSynthesize.scan();
    state.candidates = candidates;

    // Tier one — registered first so the model sees them before page actions.
    const cosmetic = window.__inscribeTinker ? tinkerTools() : [];
    state.cosmetic = cosmetic;
    for (const t of cosmetic) {
      try {
        await inscribe.host.registerTool(
          {
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { readOnlyHint: Boolean(t.readOnly), untrustedContentHint: true },
            execute: async (args) => {
              const result = await t.run(args || {});
              post('log', {
                name: t.name,
                detail: result && result.ok === false ? `refused: ${result.error}` : 'applied',
              });
              return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            },
          },
          { signal }
        );
      } catch (err) {
        post('log', { name: t.name, detail: `register failed: ${err.message}` });
      }
    }

    for (const c of candidates) {
      try {
        await inscribe.host.registerTool(
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
      if (inscribe.usingNative) {
        siteTools = (await inscribe.host.getTools()).map((t) => ({
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
      usingNative: inscribe.usingNative,
      stats,
      siteTools,
      edits: window.__inscribeTinker ? window.__inscribeTinker.summary() : null,
      cosmeticTools: cosmetic.map((t) => ({
        name: t.name,
        description: t.description,
        kind: 'cosmetic',
        trust: 'cosmetic',
        confidence: 1,
        inputSchema: t.inputSchema,
      })),
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
      const cosmeticTool = (state.cosmetic || []).find((t) => t.name === name);
      const candidate = state.candidates.find((c) => c.name === name);
      let result;
      try {
        if (cosmeticTool) {
          // Tier one: no gate.
          const out = await cosmeticTool.run(args || {});
          post('log', {
            name,
            detail: out && out.ok === false ? `refused: ${out.error}` : 'applied',
          });
          result = { content: [{ type: 'text', text: JSON.stringify(out) }] };
        } else if (candidate) {
          result = await executeCandidate(candidate, args || {});
        } else {
          result = { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
        }
      } catch (err) {
        result = { content: [{ type: 'text', text: `Tool threw: ${err.message}` }], isError: true };
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
