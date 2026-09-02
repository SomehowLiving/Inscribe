/**
 * AgentForge — DOM → WebMCP tool synthesis (MAIN world).
 *
 * This is the part the ecosystem hasn't shipped. The spec's position is
 * "annotate, don't infer": a <form> becomes a tool only if the author added
 * toolname/tooldescription. That leaves every un-annotated site out, which is
 * the adoption gap this file targets.
 *
 * Design rules, in priority order:
 *   1. Never override the author. Existing toolname/tooldescription wins, and
 *      such tools are marked `declared` (trustworthy, may auto-run).
 *   2. Prefer deterministic evidence over guessing. Accessible-name computation
 *      follows the ARIA precedence chain; schemas follow the spec's form →
 *      JSON Schema reduction. No model call is required for any of this.
 *   3. Everything inferred is `inferred` and requires human confirmation,
 *      mirroring the spec's `toolautosubmit` semantics (absent = human submits).
 *   4. Bind a stable selector to every field so execution is deterministic
 *      rather than a second round of guessing at call time.
 */
(function () {
  'use strict';

  const LOW_VALUE = [
    'nav', 'header', 'footer',
    '[role="navigation"]', '[role="menu"]', '[role="menubar"]', '[role="banner"]',
    '[role="contentinfo"]', '[role="search"] [role="listbox"]',
    '[aria-label*="breadcrumb" i]', '[class*="breadcrumb" i]',
    '[class*="cookie" i]', '[id*="cookie" i]', '[class*="consent" i]',
    '[class*="pagination" i]', '[class*="social" i]', '[class*="newsletter" i]',
  ].join(',');

  const SKIP_INPUT_TYPES = new Set([
    'hidden', 'submit', 'reset', 'button', 'image', 'file',
  ]);

  const SENSITIVE = /pass(word)?|cvv|cvc|card.?number|ssn|social.?security|pin\b|secret|token|otp|2fa/i;

  // Contexts where a FORM is genuinely worthless (as opposed to merely
  // chrome-adjacent). Search forms legitimately live in <header>/<nav>, so
  // forms get a much narrower exclusion list than actions do.
  const FORM_NOISE = '[class*="cookie" i],[id*="cookie" i],[class*="consent" i],[class*="newsletter" i]';

  // A bare link with only visible text scores 0.35, which is not enough signal
  // to be worth an agent's attention — pages like Wikipedia have hundreds.
  const MIN_ACTION_CONFIDENCE = 0.5;
  const MAX_ACTIONS = 25;

  function clean(v) {
    return String(v || '').replace(/\s+/g, ' ').trim();
  }

  function slug(v) {
    return String(v || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  // Hash-like or single-letter-fragment names carry no meaning — reject them
  // so we don't emit tools called `x_a_7f3b`.
  function isOpaque(v) {
    const s = slug(v);
    if (!s) return true;
    if (/[a-f0-9]{10,}/i.test(s.replace(/_/g, ''))) return true;
    const parts = s.split('_').filter(Boolean);
    return parts.length > 1 && parts.every((p) => p.length <= 2);
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    if (el.disabled) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0 || el.type === 'radio' || el.type === 'checkbox';
  }

  function inNoise(el) {
    try {
      return Boolean(el.closest(LOW_VALUE));
    } catch {
      return false;
    }
  }

  function labelFor(control) {
    // <label for> and ancestor <label>, with nested controls stripped out.
    const collect = (label) => {
      if (!label) return '';
      const copy = label.cloneNode(true);
      copy.querySelectorAll('input, select, textarea, button, output').forEach((n) => n.remove());
      return clean(copy.textContent);
    };
    if (control.labels && control.labels.length) {
      const joined = [...control.labels].map(collect).filter(Boolean).join(' ');
      if (joined) return joined;
    }
    return collect(control.closest('label'));
  }

  /**
   * Accessible name, following ARIA precedence rather than the simplified
   * aria-label→title→text chain the prior art uses.
   */
  function accessibleName(el) {
    if (!el) return { value: '', source: 'none' };

    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const text = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => clean(n.textContent))
        .filter(Boolean)
        .join(' ');
      if (text) return { value: text, source: 'aria-labelledby' };
    }

    const aria = clean(el.getAttribute('aria-label'));
    if (aria) return { value: aria, source: 'aria-label' };

    const lbl = labelFor(el);
    if (lbl) return { value: lbl, source: 'label' };

    const title = clean(el.getAttribute('title'));
    if (title) return { value: title, source: 'title' };

    const ph = clean(el.getAttribute('placeholder'));
    if (ph) return { value: ph, source: 'placeholder' };

    if (el.localName === 'input' && el.type !== 'password') {
      const v = clean(el.value);
      if (v) return { value: v, source: 'value' };
    }

    const text = clean(el.textContent);
    if (text && text.length <= 120) return { value: text, source: 'text' };

    const name = clean(el.getAttribute('name'));
    if (name) return { value: name, source: 'name-attr' };

    return { value: '', source: 'none' };
  }

  function paramDescription(control) {
    const explicit = clean(control.getAttribute('toolparamdescription'));
    if (explicit) return { value: explicit, source: 'toolparamdescription' };
    const lbl = labelFor(control);
    if (lbl) return { value: lbl, source: 'label' };
    const ariaDesc = clean(control.getAttribute('aria-description'));
    if (ariaDesc) return { value: ariaDesc, source: 'aria-description' };
    const ph = clean(control.getAttribute('placeholder'));
    if (ph) return { value: ph, source: 'placeholder' };
    return { value: '', source: 'none' };
  }

  /** Stable-ish selector, preferring id > name > nth-of-type path. */
  function selectorFor(el) {
    const esc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'));
    if (el.id && !isOpaque(el.id)) return `#${esc(el.id)}`;
    const name = el.getAttribute && el.getAttribute('name');
    if (name) return `${el.localName}[name="${esc(name)}"]`;
    const path = [];
    let node = el;
    while (node && node.nodeType === 1 && path.length < 6) {
      const parent = node.parentElement;
      if (!parent) break;
      const same = [...parent.children].filter((c) => c.localName === node.localName);
      const idx = same.indexOf(node) + 1;
      path.unshift(same.length > 1 ? `${node.localName}:nth-of-type(${idx})` : node.localName);
      if (parent.id && !isOpaque(parent.id)) {
        path.unshift(`#${esc(parent.id)}`);
        break;
      }
      node = parent;
    }
    return path.join(' > ');
  }

  /** Spec-style reduction of one form control to a JSON Schema property. */
  function controlToSchema(control) {
    const t = (control.type || control.localName || '').toLowerCase();
    const schema = {};

    if (control.localName === 'select') {
      const opts = [...control.options].filter((o) => o.value !== '');
      schema.type = 'string';
      if (opts.length) schema.enum = opts.map((o) => o.value);
      if (control.multiple) {
        return { type: 'array', items: { type: 'string', ...(schema.enum ? { enum: schema.enum } : {}) } };
      }
      return schema;
    }

    if (control.localName === 'textarea') {
      schema.type = 'string';
      if (control.maxLength > 0) schema.maxLength = control.maxLength;
      return schema;
    }

    switch (t) {
      case 'checkbox':
        schema.type = 'boolean';
        break;
      case 'number':
      case 'range':
        schema.type = 'number';
        if (control.min !== '') schema.minimum = Number(control.min);
        if (control.max !== '') schema.maximum = Number(control.max);
        if (control.step !== '' && control.step !== 'any') schema.multipleOf = Number(control.step);
        break;
      case 'email':
        schema.type = 'string';
        schema.format = 'email';
        break;
      case 'url':
        schema.type = 'string';
        schema.format = 'uri';
        break;
      case 'date':
        schema.type = 'string';
        schema.format = 'date';
        break;
      case 'datetime-local':
        schema.type = 'string';
        schema.format = 'date-time';
        break;
      case 'time':
        schema.type = 'string';
        schema.format = 'time';
        break;
      case 'tel':
      case 'search':
      case 'text':
      default:
        schema.type = 'string';
        if (control.maxLength > 0) schema.maxLength = control.maxLength;
        if (control.pattern) schema.pattern = control.pattern;
        break;
    }
    return schema;
  }

  function formCandidate(form) {
    const declaredName = clean(form.getAttribute('toolname'));
    const declaredDesc = clean(form.getAttribute('tooldescription'));
    const declared = Boolean(declaredName);

    const controls = [...form.elements].filter(
      (el) =>
        el.name &&
        !SKIP_INPUT_TYPES.has((el.type || '').toLowerCase()) &&
        isVisible(el)
    );
    if (!controls.length) return null;

    // Radio groups collapse to one enum property.
    const seen = new Map();
    for (const c of controls) {
      if (!seen.has(c.name)) seen.set(c.name, []);
      seen.get(c.name).push(c);
    }

    const properties = {};
    const required = [];
    const fields = [];
    let sensitive = false;
    let droppedRequired = false;

    for (const [name, group] of seen) {
      const first = group[0];
      if (SENSITIVE.test(`${name} ${first.getAttribute('autocomplete') || ''}`) || first.type === 'password') {
        sensitive = true;
        // Never expose credential fields as agent-fillable. If one of them was
        // required, the remaining schema can't actually complete the action.
        if (group.some((g) => g.required) || first.type === 'password') droppedRequired = true;
        continue;
      }

      let schema;
      if (group.length > 1 && first.type === 'radio') {
        const values = group.map((r) => r.value).filter((v) => v !== '');
        schema = { type: 'string', ...(values.length ? { enum: values } : {}) };
      } else {
        schema = controlToSchema(first);
      }

      const desc = paramDescription(first);
      if (desc.value) schema.description = desc.value;

      properties[name] = schema;
      if (group.some((g) => g.required)) required.push(name);
      fields.push({
        name,
        selector: selectorFor(first),
        kind: first.type || first.localName,
        descriptionSource: desc.source,
      });
    }

    if (!Object.keys(properties).length) return null;

    // A credential form stripped of its credential field is a tool that cannot
    // succeed. Offering it is worse than offering nothing, so don't.
    if (droppedRequired) return { unusable: true, reason: 'credential form — required sensitive field withheld' };

    const submit = form.querySelector('[type=submit], button:not([type=button]):not([type=reset])');
    const nameGuess = accessibleName(submit) .value ||
      accessibleName(form).value ||
      clean(form.getAttribute('aria-label')) ||
      clean(form.name) ||
      'submit_form';

    const toolName = declared ? declaredName : `form_${slug(nameGuess) || 'submit'}`;
    const label = declaredDesc || (submit ? accessibleName(submit).value : '') || nameGuess;

    let confidence = declared ? 1 : 0.5;
    const evidence = [];
    if (declared) evidence.push('author-declared toolname');
    if (form.getAttribute('action')) { confidence += 0.1; evidence.push('has action'); }
    if (fields.some((f) => f.descriptionSource === 'label')) { confidence += 0.2; evidence.push('labelled fields'); }
    if (submit) { confidence += 0.1; evidence.push('explicit submit control'); }
    if (required.length) { confidence += 0.1; evidence.push('required fields declared'); }

    return {
      kind: 'form',
      trust: declared ? 'declared' : 'inferred',
      name: toolName,
      description: declaredDesc || `Fill and submit the "${label}" form on this page.`,
      inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) },
      selector: selectorFor(form),
      fields,
      autosubmit: form.hasAttribute('toolautosubmit'),
      confidence: Math.min(1, Number(confidence.toFixed(2))),
      evidence,
      sensitive,
    };
  }

  function actionCandidate(el) {
    const nm = accessibleName(el);
    if (!nm.value || isOpaque(nm.value)) return null;
    if (nm.value.length > 80) return null;

    // Score by how much real semantic signal the element carries.
    let confidence = 0.3;
    const evidence = [`name from ${nm.source}`];
    if (nm.source === 'aria-label' || nm.source === 'aria-labelledby') { confidence += 0.2; evidence.push('explicit ARIA name'); }
    if (el.localName === 'button' || el.getAttribute('role') === 'button') { confidence += 0.15; evidence.push('button semantics'); }
    if (el.localName === 'a' && el.getAttribute('href')) { confidence += 0.05; evidence.push('link with href'); }
    if (el.dataset && Object.keys(el.dataset).length) { confidence += 0.05; evidence.push('data-* action hints'); }

    const verb = slug(nm.value);
    if (!verb) return null;

    return {
      kind: 'action',
      trust: 'inferred',
      name: `click_${verb}`.slice(0, 60),
      description: `Activate the "${nm.value}" control on this page.`,
      inputSchema: { type: 'object', properties: {} },
      selector: selectorFor(el),
      fields: [],
      autosubmit: false,
      confidence: Math.min(1, Number(confidence.toFixed(2))),
      evidence,
      sensitive: SENSITIVE.test(nm.value),
    };
  }

  function scan() {
    const forms = [];
    const actions = [];
    const stats = {
      forms: 0, actions: 0,
      skippedNoise: 0, skippedOpaque: 0,
      skippedLowConfidence: 0, skippedUnusable: 0, cappedActions: 0,
    };

    for (const form of document.querySelectorAll('form')) {
      if (!isVisible(form) && !form.querySelector('input,select,textarea')) continue;
      // Forms only get excluded from genuinely dead contexts, not all page
      // chrome — a site's search form usually lives in the header.
      if (!form.hasAttribute('toolname')) {
        try {
          if (form.closest(FORM_NOISE)) { stats.skippedNoise++; continue; }
        } catch { /* bad selector support; keep the form */ }
      }
      const c = formCandidate(form);
      if (!c) continue;
      if (c.unusable) { stats.skippedUnusable++; continue; }
      forms.push(c);
      stats.forms++;
    }

    const actionSel = 'button, [role="button"], a[href], input[type=submit], [data-action]';
    for (const el of document.querySelectorAll(actionSel)) {
      if (!isVisible(el)) continue;
      if (inNoise(el)) { stats.skippedNoise++; continue; }
      if (el.closest('form') && el.type === 'submit') continue; // covered by its form
      const c = actionCandidate(el);
      if (!c) { stats.skippedOpaque++; continue; }
      if (c.confidence < MIN_ACTION_CONFIDENCE) { stats.skippedLowConfidence++; continue; }
      actions.push(c);
    }

    actions.sort((a, b) => b.confidence - a.confidence);
    if (actions.length > MAX_ACTIONS) {
      stats.cappedActions = actions.length - MAX_ACTIONS;
      actions.length = MAX_ACTIONS;
    }
    stats.actions = actions.length;

    // De-dupe by tool name, keeping the highest-confidence variant. Forms come
    // first so a form always wins a name collision with a button.
    const byName = new Map();
    for (const c of [...forms, ...actions]) {
      const prev = byName.get(c.name);
      if (!prev || c.confidence > prev.confidence) byName.set(c.name, c);
    }

    const deduped = [...byName.values()].sort((a, b) => b.confidence - a.confidence);
    return { candidates: deduped, stats, url: location.href, title: document.title };
  }

  window.__agentforgeSynthesize = { scan, accessibleName, selectorFor };
})();
