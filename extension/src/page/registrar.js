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

  // Chrome's documented budgets: 30 chars for names, 500 for tool
  // descriptions, 150 for parameter descriptions. These are not cosmetic —
  // page-derived text is attacker-controlled, and an unbounded "description"
  // is a prompt-injection carrier. Strip control characters and anything that
  // could terminate a delimiter, then hard-truncate.
  const LIMITS = { name: 30, description: 500, param: 150 };

  function clean(text, budget) {
    return String(text == null ? '' : text)
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')  // control chars, incl. newlines
      .replace(/[`\u2028\u2029]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, budget);
  }

  function safeName(name) {
    return clean(name, LIMITS.name).replace(/[^A-Za-z0-9_.\-]/g, '_') || 'unnamed_tool';
  }

  function sanitizeSchema(schema) {
    if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} };
    const props = {};
    for (const [k, v] of Object.entries(schema.properties || {})) {
      const p = { ...v };
      if (p.description) p.description = clean(p.description, LIMITS.param);
      props[clean(k, LIMITS.name) || 'field'] = p;
    }
    return { ...schema, properties: props };
  }

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
    const A = () => window.__inscribeAnnotate;
    const targetProp = {
      type: 'string',
      description: 'A target name from inscribe.ui.targets, a landmark word like "header"/"sidebar"/"page", or a CSS selector.',
    };
    return [
      {
        name: 'inscribe.ui.targets',
        title: 'List tinkerable parts',
        description: 'List the parts of this page that can be restyled, hidden, or retitled. Call this first to learn what names are available.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: () => T().catalog(),
      },
      {
        name: 'inscribe.ui.theme',
        title: 'Apply a page theme',
        description: 'Apply a whole-page theme. "dark" is fast filter inversion; "smartdark" instead recolours the page\u2019s own colours (slower, but leaves photos and brand colours alone \u2014 try it when "dark" looks wrong). Also "dimmed", "grayscale", "sepia", or "none" to remove. Prefer this over restyling backgrounds by hand — it recolours the rendered page, so it works even when the site paints its own backgrounds on inner containers.',
        inputSchema: {
          type: 'object',
          properties: { mode: { type: 'string', enum: ['dark', 'smartdark', 'dimmed', 'grayscale', 'sepia', 'none'] } },
          required: ['mode'],
        },
        run: (a) => T().theme(a.mode),
      },
      {
        name: 'inscribe.ui.restyle',
        title: 'Restyle part of the page',
        description: 'Change how part of the page looks. Pass CSS property/value pairs, e.g. {"background":"#111","color":"#eee","font-size":"18px","padding":"24px"}. Set deep:true for colours and type, which otherwise lose to the site\u2019s own rules. Applies immediately and persists for this site.',
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
        run: (a) => {
          // Typography and spacing reach descendants or the site's own rules
          // win, so infer `deep` when the agent didn't ask for it explicitly.
          const needsDeep = Object.keys(a.css || {}).some((k) =>
            /^(color|font|line-height|letter-spacing|text-)/.test(k)
          );
          return T().restyle(a.target, a.css, a.deep ?? needsDeep);
        },
      },
      {
        name: 'inscribe.ui.move',
        title: 'Move part of the page',
        description: 'Move part of the page to the top, bottom, left, or right of its container. Only reflows where the parent layout allows it.',
        inputSchema: {
          type: 'object',
          properties: {
            target: targetProp,
            where: { type: 'string', enum: ['top', 'bottom', 'left', 'right'] },
          },
          required: ['target', 'where'],
        },
        run: (a) => T().move(a.target, a.where),
      },
      {
        name: 'inscribe.ui.hide',
        title: 'Hide part of the page',
        description: 'Hide part of the page from view (the "zap" action). Reversible with inscribe.ui.show or undo.',
        inputSchema: { type: 'object', properties: { target: targetProp }, required: ['target'] },
        run: (a) => T().hide(a.target),
      },
      {
        name: 'inscribe.ui.show',
        title: 'Un-hide part of the page',
        description: 'Un-hide something previously hidden.',
        inputSchema: { type: 'object', properties: { target: targetProp }, required: ['target'] },
        run: (a) => T().show(a.target),
      },
      {
        name: 'inscribe.ui.setText',
        title: 'Replace visible text',
        description: 'Replace the visible text of an element. Affects only your view of the page.',
        inputSchema: {
          type: 'object',
          properties: { target: targetProp, text: { type: 'string' } },
          required: ['target', 'text'],
        },
        run: (a) => T().setText(a.target, a.text),
      },
      {
        name: 'inscribe.ui.swapImage',
        title: 'Swap an image',
        description: 'Replace an image on the page with a different one. Works on <img> elements, or sets a background-image on anything else.',
        inputSchema: {
          type: 'object',
          properties: { target: targetProp, url: { type: 'string', description: 'http(s) or data:image URI' } },
          required: ['target', 'url'],
        },
        run: (a) => T().swapImage(a.target, a.url),
      },
      {
        name: 'inscribe.draw.highlight',
        title: 'Highlight an element',
        description: 'Draw a highlight box around part of the page, optionally with a small label. Use to point something out.',
        inputSchema: {
          type: 'object',
          properties: { target: targetProp, label: { type: 'string' }, color: { type: 'string' } },
          required: ['target'],
        },
        run: (a) => A().highlight(a.target, a.label, a.color),
      },
      {
        name: 'inscribe.draw.note',
        title: 'Attach a note',
        description: 'Stick a note on the page, anchored beside an element. Use for commentary, review remarks, or reminders.',
        inputSchema: {
          type: 'object',
          properties: { target: targetProp, text: { type: 'string' } },
          required: ['text'],
        },
        run: (a) => A().note(a.target, a.text),
      },
      {
        name: 'inscribe.draw.arrow',
        title: 'Draw an arrow',
        description: 'Draw an arrow from one part of the page to another, to show a relationship or a flow.',
        inputSchema: {
          type: 'object',
          properties: { from: targetProp, to: targetProp, color: { type: 'string' } },
          required: ['from', 'to'],
        },
        run: (a) => A().arrow(a.from, a.to, a.color),
      },
      {
        name: 'inscribe.draw.pick',
        title: 'Ask the human to point',
        description: 'Ask the human to click an element on the page, then annotate it. kind is "highlight" or "note". Use when you do not know which element they mean.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['highlight', 'note'] },
            text: { type: 'string', description: 'Note body, when kind is "note".' },
          },
          required: ['kind'],
        },
        run: (a) => A().pick(a.kind, { text: a.text }),
      },
      {
        name: 'inscribe.draw.export',
        title: 'Export annotations',
        description: 'Export this page\u2019s annotations and appearance edits as a portable record that can be shared or re-imported.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: () => A().exportAll(),
      },
      {
        name: 'inscribe.guide.walk',
        title: 'Show me how',
        description: 'Teach the human where things are instead of doing it for them: move a pointer to each place in turn, ring it, and say what it is for. Use this when someone asks how to do something, where something is, or to be shown around — rather than asking you to perform the action. Call inscribe.ui.targets first to learn what you can point at.',
        inputSchema: {
          type: 'object',
          properties: {
            steps: {
              type: 'array',
              description: 'The places to visit, in order.',
              items: {
                type: 'object',
                properties: {
                  target: { type: 'string', description: 'Target name, landmark word, or CSS selector' },
                  say: { type: 'string', description: 'One short sentence explaining this step' },
                },
                required: ['target'],
              },
            },
            pace: { type: 'number', description: 'Milliseconds to linger on each step. Default 2400.' },
          },
          required: ['steps'],
        },
        run: (a) => A().guide(a.steps, { pace: a.pace }),
      },
      {
        name: 'inscribe.guide.stop',
        title: 'Stop the walkthrough',
        description: 'Stop a walkthrough that is currently running.',
        inputSchema: { type: 'object', properties: {} },
        run: () => A().stopGuide(),
      },
      {
        name: 'inscribe.draw.list',
        title: 'List annotations',
        description: 'List the annotations currently on this page.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: () => A().list(),
      },
      {
        name: 'inscribe.draw.clear',
        title: 'Clear annotations',
        description: 'Remove every annotation from this page.',
        inputSchema: { type: 'object', properties: {} },
        run: () => A().clear(),
      },
      {
        name: 'inscribe.ui.undo',
        title: 'Undo last change',
        description: 'Undo the last appearance change.',
        inputSchema: { type: 'object', properties: {} },
        run: () => T().undo(),
      },
      {
        name: 'inscribe.ui.reset',
        title: 'Restore this site',
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
    // These go in Inscribe's OWN context: restyling a page is a capability of
    // the extension over the page, not a capability the page declared.
    const cosmetic = window.__inscribeTinker ? tinkerTools() : [];
    state.cosmetic = cosmetic;
    for (const t of cosmetic) {
      try {
        await inscribe.own.registerTool(
          {
            name: t.name,
            title: t.title || t.name.split('.').pop(),
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { readOnlyHint: Boolean(t.readOnly), untrustedContentHint: false },
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

    // What the site declares for itself, read before we register anything.
    // A declaration always beats an inference: if the author annotated a form
    // with toolname, the browser (or the site) already owns that capability and
    // duplicating it in our context would shadow the real schema with a guess.
    let declaredNames = new Set();
    try {
      declaredNames = new Set((await inscribe.page.getTools()).map((t) => t.name));
    } catch { /* page context may reject; nothing to defer to */ }

    // Inferred page tools go in OUR context, tagged untrusted — they are
    // guesses about the site, not the site's own declarations.
    let suppressed = 0;
    for (const c of candidates) {
      if (declaredNames.has(safeName(c.name))) {
        suppressed++;
        continue;
      }
      try {
        await inscribe.own.registerTool(
          {
            name: safeName(c.name),
            title: clean(c.description, 60),
            description: clean(c.description, LIMITS.description),
            inputSchema: sanitizeSchema(c.inputSchema),
            annotations: {
              readOnlyHint: false,
              untrustedContentHint: true, // page-derived; never treat as instructions
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
    // Surface the site's declarations for the panel. Read, never written.
    let siteTools = [];
    try {
      {
        siteTools = (await inscribe.page.getTools()).map((t) => ({
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
      stats: { ...stats, suppressedAsDeclared: suppressed },
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

    // Toolbar actions go straight to the annotation layer. These are the
    // human's own clicks, not the agent's, so there's nothing to gate.
    if (data.type === 'annotate') {
      const A = window.__inscribeAnnotate;
      if (!A) return;
      const p = data.payload || {};
      if (p.action === 'pen') A.setPen(p.on);
      else if (p.action === 'pick') {
        const res = await A.pick(p.kind, { text: p.text });
        post('log', {
          name: `draw.${p.kind}`,
          detail: res && res.ok ? 'placed' : `not placed: ${res && res.error}`,
        });
      } else if (p.action === 'clearMarks') {
        A.clear();
        post('log', { name: 'draw.clear', detail: 'cleared' });
      } else if (p.action === 'export') {
        window.postMessage(
          { source: PAGE, type: 'annotate-export', payload: A.exportAll() },
          window.location.origin
        );
      } else if (p.action === 'import') {
        const res = A.importAll(p.data);
        post('log', {
          name: 'draw.import',
          detail: res.ok ? `restored ${res.annotations} mark(s)` : res.error,
        });
      }
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
    // ---- WebMCP discovery -------------------------------------------------
    // The agent's only way to learn what it can do. Asks both contexts via
    // getTools(); provenance comes from WHICH context answered, not from a
    // flag we set by hand.
    if (data.type === 'discover') {
      const inscribe = window.__inscribe;
      const trace = { site: [], inscribe: [], errors: [] };

      try {
        for (const t of await inscribe.page.getTools()) {
          trace.site.push({
            name: t.name, title: t.title, description: t.description,
            inputSchema: t.inputSchema, annotations: t.annotations,
            provenance: 'site-declared', context: 'document.modelContext',
          });
        }
      } catch (err) {
        trace.errors.push(`document.modelContext.getTools(): ${err.name || 'Error'}`);
      }

      try {
        for (const t of await inscribe.own.getTools()) {
          trace.inscribe.push({
            name: t.name, title: t.title, description: t.description,
            inputSchema: t.inputSchema, annotations: t.annotations,
            provenance: (t.annotations && t.annotations.untrustedContentHint)
              ? 'inferred-from-dom' : 'inscribe-extension',
            context: 'inscribe.own',
          });
        }
      } catch (err) {
        trace.errors.push(`inscribe.own.getTools(): ${err.name || 'Error'}`);
      }

      post('discovery', {
        url: location.href,
        title: document.title,
        usingNative: inscribe.usingNative,
        counts: { site: trace.site.length, inscribe: trace.inscribe.length },
        ...trace,
      });
      return;
    }

    // ---- WebMCP invocation ------------------------------------------------
    // Execution goes through executeTool(). There is deliberately no direct
    // function-call fallback: if WebMCP is unavailable or the tool isn't
    // registered, the agent cannot act. That is what makes it load-bearing.
    if (data.type === 'execute') {
      const { name, args, callId } = data.payload;
      const inscribe = window.__inscribe;
      let result;

      try {
        if (!inscribe || !inscribe.own || typeof inscribe.own.executeTool !== 'function') {
          throw new Error('WebMCP unavailable: no ModelContext to execute through.');
        }

        // Resolve the tool by asking the contexts, in trust order: whatever
        // the site declared wins over anything we inferred.
        let owner = null;
        let handle = null;

        try {
          const siteTools = await inscribe.page.getTools();
          handle = siteTools.find((t) => t.name === name) || null;
          if (handle) owner = inscribe.page;
        } catch { /* page context may reject; fall through to ours */ }

        if (!handle) {
          const ownTools = await inscribe.own.getTools();
          handle = ownTools.find((t) => t.name === name) || null;
          if (handle) owner = inscribe.own;
        }

        if (!handle) {
          result = {
            content: [{ type: 'text', text: `No WebMCP tool named "${name}" is registered on this page.` }],
            isError: true,
          };
        } else {
          post('log', {
            name,
            detail: `executeTool via ${owner === inscribe.page ? 'document.modelContext' : 'inscribe.own'}`,
          });
          // Spec: executeTool resolves to a DOMString.
          const raw = await owner.executeTool(handle, args || {});
          try {
            result = JSON.parse(raw);
          } catch {
            result = { content: [{ type: 'text', text: String(raw) }] };
          }
        }
      } catch (err) {
        result = {
          content: [{ type: 'text', text: `${err.name || 'Error'}: ${err.message}` }],
          isError: true,
        };
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
