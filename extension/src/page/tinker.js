/**
 * Inscribe — tinker engine (MAIN world).
 *
 * The cosmetic half of the product: describe a change, see it on the page,
 * and have it still be there tomorrow. This is tier one of two — these tools
 * apply immediately without a confirmation prompt, because a restyle is
 * trivially reversible and asking permission for "make it darker" would be
 * unbearable. State-changing tools (forms, clicks) keep the gate.
 *
 * Two implementation choices worth knowing:
 *
 *  1. Restyling and hiding go through a single injected stylesheet, not inline
 *     styles. A CSS rule matches elements that appear LATER, so a React
 *     re-render can't wipe your changes — no observer needed. Inline styles
 *     would lose that fight constantly.
 *  2. Text overrides can't work that way (CSS can't replace text content), so
 *     those alone are re-applied by a MutationObserver.
 *
 * Everything persists per origin, so revisiting the site restores your edits.
 */
(function () {
  'use strict';

  if (window.__inscribeTinker) return;

  const STYLE_ID = '__inscribe_tinker_sheet';
  const KEY = `inscribe:tinker:${location.origin}`;

  const state = {
    rules: new Map(),   // selector -> { [prop]: value }
    hidden: new Set(),  // selectors
    texts: new Map(),   // selector -> string
    theme: null,        // 'dark' | 'sepia' | null
    history: [],        // for undo
  };

  /**
   * Whole-page themes.
   *
   * Setting `body { background: #111 }` looks correct in the computed style and
   * changes almost nothing on a real site, because content sits in descendants
   * that paint their own backgrounds. Filter inversion sidesteps the cascade
   * entirely — it recolours the rendered result — and then un-inverts images and
   * video so photographs don't come out as negatives. This is what hand-written
   * dark-mode userstyles do, and it's why they work on sites they've never seen.
   */
  const THEMES = {
    dark:
      'html{filter:invert(1) hue-rotate(180deg) contrast(0.92)!important;background:#111!important}' +
      'img,video,picture,canvas,svg image,[style*="background-image"],iframe' +
      '{filter:invert(1) hue-rotate(180deg)!important}',
    sepia:
      'html{filter:sepia(0.55) contrast(0.95) brightness(1.02)!important}',
  };

  // Properties we refuse to touch: they don't restyle a page so much as
  // let it lie about what it is (fake overlays, spoofed cursors).
  const BLOCKED_PROPS = new Set(['content', 'cursor', 'pointer-events', 'user-select']);

  function kebab(p) {
    return String(p).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().trim();
  }

  function sheet() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    return el;
  }

  function render() {
    const parts = [];
    if (state.theme && THEMES[state.theme]) parts.push(THEMES[state.theme]);
    for (const [sel, props] of state.rules) {
      const decls = Object.entries(props)
        .map(([k, v]) => `${kebab(k)}: ${v} !important`)
        .join('; ');
      if (decls) parts.push(`${sel} { ${decls} }`);
    }
    for (const sel of state.hidden) {
      parts.push(`${sel} { display: none !important; }`);
    }
    sheet().textContent = parts.join('\n');
    applyTexts();
    persist();
  }

  function applyTexts() {
    for (const [sel, text] of state.texts) {
      let nodes = [];
      try { nodes = document.querySelectorAll(sel); } catch { continue; }
      for (const n of nodes) {
        if (n.textContent !== text) n.textContent = text;
      }
    }
  }

  function persist() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          rules: [...state.rules],
          hidden: [...state.hidden],
          texts: [...state.texts],
          theme: state.theme,
        })
      );
    } catch { /* quota or private mode — edits still live for this session */ }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return 0;
      const d = JSON.parse(raw);
      state.rules = new Map(d.rules || []);
      state.hidden = new Set(d.hidden || []);
      state.texts = new Map(d.texts || []);
      state.theme = d.theme || null;
      render();
      return state.rules.size + state.hidden.size + state.texts.size + (state.theme ? 1 : 0);
    } catch {
      return 0;
    }
  }

  /** Resolve a target: either a name from the catalog, or a raw CSS selector. */
  function resolve(target) {
    const t = String(target || '').trim();
    if (!t) return null;
    const hit = catalog().find(
      (c) => c.name === t || c.label.toLowerCase() === t.toLowerCase()
    );
    if (hit) return hit.selector;
    // treat as a selector, but only if it actually matches something
    try {
      if (document.querySelector(t)) return t;
    } catch { /* not a valid selector */ }
    return null;
  }

  /**
   * The catalog of things worth tinkering with. Landmarks and headings first,
   * because those are what people actually name out loud ("the header", "the
   * sidebar", "the title").
   */
  function catalog() {
    const selFor = (el) =>
      window.__inscribeSynthesize ? window.__inscribeSynthesize.selectorFor(el) : null;
    const nameOf = (el) =>
      window.__inscribeSynthesize ? window.__inscribeSynthesize.accessibleName(el).value : '';

    const out = [];
    const seen = new Set();
    const add = (el, label, kind) => {
      if (!el) return;
      const sel = selFor(el);
      if (!sel || seen.has(sel)) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      seen.add(sel);
      out.push({
        name: kind + (out.length + 1),
        label,
        kind,
        selector: sel,
      });
    };

    // Semantic landmarks — the vocabulary people use for page furniture.
    const landmarks = [
      ['header, [role=banner]', 'header'],
      ['nav, [role=navigation]', 'navigation'],
      ['main, [role=main]', 'main content'],
      ['aside, [role=complementary]', 'sidebar'],
      ['footer, [role=contentinfo]', 'footer'],
      ['article', 'article'],
      ['form', 'form'],
    ];
    for (const [sel, label] of landmarks) {
      let els = [];
      try { els = document.querySelectorAll(sel); } catch { continue; }
      [...els].slice(0, 3).forEach((el) => add(el, label, 'region'));
    }

    // Headings carry the page's own labels.
    [...document.querySelectorAll('h1, h2')].slice(0, 8).forEach((el) => {
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (txt) add(el, `${el.localName}: "${txt}"`, 'heading');
    });

    // Images and media, for hiding or resizing.
    [...document.querySelectorAll('img, video')].slice(0, 6).forEach((el) => {
      add(el, `${el.localName}: ${nameOf(el) || el.getAttribute('src') || 'unnamed'}`.slice(0, 70), 'media');
    });

    // Whole page, as an explicit target.
    out.unshift({ name: 'page', label: 'the whole page', kind: 'region', selector: 'body' });
    return out;
  }

  function pushHistory() {
    state.history.push({
      rules: new Map([...state.rules].map(([k, v]) => [k, { ...v }])),
      hidden: new Set(state.hidden),
      texts: new Map(state.texts),
      theme: state.theme,
    });
    if (state.history.length > 40) state.history.shift();
  }

  const api = {
    catalog,

    theme(mode) {
      const m = String(mode || '').toLowerCase();
      if (m !== 'dark' && m !== 'sepia' && m !== 'none') {
        return { ok: false, error: 'mode must be "dark", "sepia", or "none".' };
      }
      pushHistory();
      state.theme = m === 'none' ? null : m;
      render();
      return { ok: true, theme: state.theme };
    },

    restyle(target, css, deep) {
      const sel = resolve(target);
      if (!sel) return { ok: false, error: `No such target: "${target}". Call inscribe.ui.targets to list them.` };
      if (!css || typeof css !== 'object' || !Object.keys(css).length) {
        return { ok: false, error: 'Provide css as an object, e.g. { "background": "#111", "color": "#eee" }.' };
      }
      pushHistory();
      const props = state.rules.get(sel) || {};
      const rejected = [];
      for (const [k, v] of Object.entries(css)) {
        if (BLOCKED_PROPS.has(kebab(k))) { rejected.push(k); continue; }
        props[kebab(k)] = String(v);
      }
      // Real sites paint backgrounds on descendants, so a rule on the container
      // alone often changes nothing visible. `deep` covers the subtree.
      state.rules.set(deep ? `${sel}, ${sel} *` : sel, props);
      render();
      return {
        ok: true, target, selector: deep ? `${sel}, ${sel} *` : sel, deep: Boolean(deep),
        applied: Object.keys(props),
        ...(rejected.length ? { rejected } : {}),
      };
    },

    hide(target) {
      const sel = resolve(target);
      if (!sel) return { ok: false, error: `No such target: "${target}".` };
      pushHistory();
      state.hidden.add(sel);
      render();
      return { ok: true, target, selector: sel, hidden: true };
    },

    show(target) {
      const sel = resolve(target);
      if (!sel) return { ok: false, error: `No such target: "${target}".` };
      pushHistory();
      state.hidden.delete(sel);
      render();
      return { ok: true, target, selector: sel, hidden: false };
    },

    setText(target, text) {
      const sel = resolve(target);
      if (!sel) return { ok: false, error: `No such target: "${target}".` };
      pushHistory();
      state.texts.set(sel, String(text));
      render();
      return { ok: true, target, selector: sel, text: String(text) };
    },

    undo() {
      const prev = state.history.pop();
      if (!prev) return { ok: false, error: 'Nothing to undo.' };
      state.rules = prev.rules;
      state.hidden = prev.hidden;
      state.texts = prev.texts;
      state.theme = prev.theme;
      render();
      return { ok: true, remaining: state.history.length };
    },

    reset() {
      pushHistory();
      state.rules.clear();
      state.hidden.clear();
      state.texts.clear();
      state.theme = null;
      render();
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      return { ok: true, reset: true };
    },

    summary() {
      return {
        theme: state.theme,
        restyled: state.rules.size,
        hidden: state.hidden.size,
        retexted: state.texts.size,
        canUndo: state.history.length > 0,
      };
    },
  };

  window.__inscribeTinker = api;

  // Re-apply text overrides through re-renders. Styling doesn't need this —
  // the stylesheet already covers nodes that appear later.
  const mo = new MutationObserver(() => {
    if (state.texts.size) applyTexts();
  });

  function boot() {
    const n = restore();
    mo.observe(document.documentElement, { childList: true, subtree: true });
    if (n) console.debug(`[Inscribe] restored ${n} edit(s) for ${location.origin}`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
