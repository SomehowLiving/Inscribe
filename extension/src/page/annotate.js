/**
 * Inscribe — annotation layer (MAIN world).
 *
 * Drawing on a page, which is a different capability class from restyling:
 * CSS can't express "circle this and write a note next to it".
 *
 * The design decision that matters: annotations anchor to ELEMENTS, not to
 * viewport pixels. A coordinate-based scribble is wrong the moment you scroll,
 * resize, or the site reflows — and it's also useless to an agent, which has
 * no idea where pixel 840,220 is. Anchoring to a selector means "highlight the
 * price" survives a reload and is something a model can actually ask for.
 *
 * Freehand strokes are the exception; those are inherently positional, so they
 * store document-space points and are redrawn on scroll and resize.
 */
(function () {
  'use strict';

  if (window.__inscribeAnnotate) return;

  const LAYER_ID = '__inscribe_annotation_layer';
  const KEY = `inscribe:annotate:${location.origin}${location.pathname}`;

  const state = {
    marks: [],     // { id, kind, selector?, text?, color?, points? }
    seq: 0,
    penMode: false,
    penColor: '#c8552b',
  };

  function layer() {
    let host = document.getElementById(LAYER_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = LAYER_ID;
      host.style.cssText = [
        'position:absolute', 'top:0', 'left:0',
        'width:100%', 'height:100%',
        'pointer-events:none',
        'z-index:2147483000',
        'overflow:visible',
      ].join(';');
      (document.body || document.documentElement).appendChild(host);
    }
    return host;
  }

  function docRect(el) {
    const r = el.getBoundingClientRect();
    return {
      top: r.top + window.scrollY,
      left: r.left + window.scrollX,
      width: r.width,
      height: r.height,
    };
  }

  function el(tag, css, text) {
    const n = document.createElement(tag);
    n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  }

  function drawHighlight(mark, host) {
    const t = document.querySelector(mark.selector);
    if (!t) return;
    const r = docRect(t);
    const box = el(
      'div',
      `position:absolute;top:${r.top - 3}px;left:${r.left - 3}px;` +
        `width:${r.width + 6}px;height:${r.height + 6}px;` +
        `background:${mark.color}22;border:2px solid ${mark.color};border-radius:3px;` +
        'pointer-events:none;box-sizing:border-box'
    );
    host.appendChild(box);
    if (mark.text) {
      const tag = el(
        'div',
        `position:absolute;top:${r.top - 24}px;left:${r.left - 3}px;` +
          `background:${mark.color};color:#fff;font:600 11px/1.4 ui-sans-serif,system-ui,sans-serif;` +
          'padding:2px 7px;border-radius:2px;pointer-events:none;white-space:nowrap',
        mark.text
      );
      host.appendChild(tag);
    }
  }

  function drawNote(mark, host) {
    const t = mark.selector ? document.querySelector(mark.selector) : null;
    const r = t ? docRect(t) : { top: window.scrollY + 80, left: window.scrollX + 40, width: 0, height: 0 };
    const note = el(
      'div',
      `position:absolute;top:${r.top}px;left:${r.left + r.width + 12}px;max-width:220px;` +
        'background:#fdf6d8;color:#2b2515;border:1px solid #d8c98a;' +
        'box-shadow:0 3px 12px rgba(0,0,0,.22);border-radius:2px;padding:9px 11px;' +
        "font:400 12px/1.5 'Iowan Old Style',Georgia,serif;pointer-events:auto;white-space:pre-wrap",
      mark.text || ''
    );
    // A note you can't get rid of is a nuisance.
    const x = el(
      'span',
      'position:absolute;top:2px;right:5px;cursor:pointer;font:600 12px/1 sans-serif;color:#8a7a45',
      '×'
    );
    x.onclick = () => api.remove(mark.id);
    note.appendChild(x);
    host.appendChild(note);
  }

  function drawArrow(mark, host) {
    const a = document.querySelector(mark.from);
    const b = document.querySelector(mark.to);
    if (!a || !b) return;
    const ra = docRect(a);
    const rb = docRect(b);
    const x1 = ra.left + ra.width / 2;
    const y1 = ra.top + ra.height / 2;
    const x2 = rb.left + rb.width / 2;
    const y2 = rb.top + rb.height / 2;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    const minX = Math.min(x1, x2) - 20;
    const minY = Math.min(y1, y2) - 20;
    const w = Math.abs(x2 - x1) + 40;
    const h = Math.abs(y2 - y1) + 40;
    svg.setAttribute('style', `position:absolute;top:${minY}px;left:${minX}px;pointer-events:none;overflow:visible`);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', String(x1 - minX));
    line.setAttribute('y1', String(y1 - minY));
    line.setAttribute('x2', String(x2 - minX));
    line.setAttribute('y2', String(y2 - minY));
    line.setAttribute('stroke', mark.color);
    line.setAttribute('stroke-width', '2.5');
    const head = document.createElementNS(svgNS, 'polygon');
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const hx = x2 - minX;
    const hy = y2 - minY;
    const s = 9;
    head.setAttribute(
      'points',
      [
        `${hx},${hy}`,
        `${hx - s * Math.cos(ang - 0.4)},${hy - s * Math.sin(ang - 0.4)}`,
        `${hx - s * Math.cos(ang + 0.4)},${hy - s * Math.sin(ang + 0.4)}`,
      ].join(' ')
    );
    head.setAttribute('fill', mark.color);
    svg.append(line, head);
    host.appendChild(svg);
  }

  function drawStroke(mark, host) {
    if (!mark.points || mark.points.length < 2) return;
    const svgNS = 'http://www.w3.org/2000/svg';
    const xs = mark.points.map((p) => p[0]);
    const ys = mark.points.map((p) => p[1]);
    const minX = Math.min(...xs) - 6;
    const minY = Math.min(...ys) - 6;
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('style', `position:absolute;top:${minY}px;left:${minX}px;pointer-events:none;overflow:visible`);
    svg.setAttribute('width', String(Math.max(...xs) - minX + 12));
    svg.setAttribute('height', String(Math.max(...ys) - minY + 12));
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute(
      'd',
      mark.points.map((p, i) => `${i ? 'L' : 'M'}${p[0] - minX} ${p[1] - minY}`).join(' ')
    );
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', mark.color);
    path.setAttribute('stroke-width', String(mark.width || 3));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    host.appendChild(svg);
  }

  function redraw() {
    const host = layer();
    host.textContent = '';
    for (const m of state.marks) {
      try {
        if (m.kind === 'highlight') drawHighlight(m, host);
        else if (m.kind === 'note') drawNote(m, host);
        else if (m.kind === 'arrow') drawArrow(m, host);
        else if (m.kind === 'stroke') drawStroke(m, host);
      } catch { /* a mark whose anchor vanished just doesn't draw */ }
    }
    persist();
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ marks: state.marks, seq: state.seq }));
    } catch { /* ignore */ }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return 0;
      const d = JSON.parse(raw);
      state.marks = d.marks || [];
      state.seq = d.seq || 0;
      redraw();
      return state.marks.length;
    } catch {
      return 0;
    }
  }

  function resolve(target) {
    if (window.__inscribeTinker && window.__inscribeTinker.resolveTarget) {
      return window.__inscribeTinker.resolveTarget(target);
    }
    try {
      return document.querySelector(String(target)) ? String(target) : null;
    } catch {
      return null;
    }
  }

  // ---- Element picker -------------------------------------------------
  // The toolbar needs a way to say "this one". Hover outlines a candidate,
  // click commits it. Clicks are swallowed in the capture phase so picking a
  // link doesn't navigate away mid-annotation.
  const picker = { active: false, kind: null, hover: null, outline: null, onDone: null };

  function outlineEl() {
    if (!picker.outline) {
      picker.outline = el(
        'div',
        'position:absolute;pointer-events:none;z-index:2147483001;' +
          'border:2px dashed #c8552b;background:rgba(200,85,43,.12);border-radius:2px'
      );
      picker.outline.id = '__inscribe_pick_outline';
    }
    if (!picker.outline.isConnected) {
      (document.body || document.documentElement).appendChild(picker.outline);
    }
    return picker.outline;
  }

  function moveOutline(target) {
    if (!target) return;
    const r = docRect(target);
    const o = outlineEl();
    o.style.top = `${r.top - 2}px`;
    o.style.left = `${r.left - 2}px`;
    o.style.width = `${r.width + 4}px`;
    o.style.height = `${r.height + 4}px`;
  }

  function endPick() {
    picker.active = false;
    picker.kind = null;
    picker.hover = null;
    if (picker.outline && picker.outline.isConnected) picker.outline.remove();
    document.documentElement.style.cursor = '';
  }

  function isOurs(node) {
    return Boolean(
      node && node.closest &&
      node.closest('#__inscribe_annotation_layer, #__inscribe_root, #__inscribe_pick_outline')
    );
  }

  document.addEventListener('pointerover', (e) => {
    if (!picker.active || isOurs(e.target)) return;
    picker.hover = e.target;
    moveOutline(e.target);
  }, true);

  document.addEventListener('click', (e) => {
    if (!picker.active) return;
    if (isOurs(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const target = picker.hover || e.target;
    const sel = window.__inscribeSynthesize
      ? window.__inscribeSynthesize.selectorFor(target)
      : null;
    const kind = picker.kind;
    const done = picker.onDone;
    endPick();
    if (!sel) {
      if (done) done({ ok: false, error: 'Could not derive a unique selector for that element.' });
      return;
    }
    let res;
    if (kind === 'highlight') res = api.highlight(sel);
    else if (kind === 'note') res = api.note(sel, picker.pendingText || 'Note');
    else res = { ok: false, error: `Unknown pick kind: ${kind}` };
    if (done) done(res);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (picker.active && e.key === 'Escape') {
      endPick();
      if (picker.onDone) picker.onDone({ ok: false, error: 'Cancelled.' });
    }
  }, true);

  // ---- Guided walkthrough ------------------------------------------------
  // The "point at it and explain" mode. Instead of the agent doing the thing,
  // it shows the human where the thing is — which is only trustworthy because
  // the target came from a declared tool or a verified selector, not from
  // guessing at pixels.
  const guideState = { running: false, cursorEl: null, abort: null };

  function cursor() {
    if (guideState.cursorEl && guideState.cursorEl.isConnected) return guideState.cursorEl;
    const c = el('div',
      'position:absolute;top:0;left:0;width:26px;height:26px;pointer-events:none;' +
      'z-index:2147483002;transition:transform 700ms cubic-bezier(.22,.61,.36,1);' +
      'will-change:transform');
    c.id = '__inscribe_cursor';
    c.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 26 26">' +
      '<circle cx="9" cy="9" r="8" fill="rgba(200,85,43,.25)"/>' +
      '<path d="M4 2 L4 18 L8.5 13.5 L11.5 20 L14 18.8 L11 12.6 L17 12.2 Z" ' +
      'fill="#c8552b" stroke="#17140f" stroke-width="1.1"/></svg>';
    (document.body || document.documentElement).appendChild(c);
    guideState.cursorEl = c;
    return c;
  }

  function ping(x, y) {
    const r = el('div',
      `position:absolute;top:${y - 13}px;left:${x - 13}px;width:26px;height:26px;` +
      'border:2px solid #c8552b;border-radius:50%;pointer-events:none;z-index:2147483001;' +
      'opacity:.9;transition:transform 520ms ease-out,opacity 520ms ease-out');
    (document.body || document.documentElement).appendChild(r);
    requestAnimationFrame(() => {
      r.style.transform = 'scale(2.6)';
      r.style.opacity = '0';
    });
    setTimeout(() => r.remove(), 600);
  }

  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('Guide stopped', 'AbortError'));
        }, { once: true });
      }
    });
  }

  const api = {
    /**
     * Walk the human through a sequence of places on the page: move a cursor
     * to each target, ring it, label it, and say what it's for.
     */
    async guide(steps, opts = {}) {
      if (!Array.isArray(steps) || !steps.length) {
        return { ok: false, error: 'steps must be a non-empty array of { target, say }.' };
      }
      if (guideState.running) return { ok: false, error: 'A walkthrough is already running.' };

      guideState.running = true;
      guideState.abort = new AbortController();
      const { signal } = guideState.abort;
      const pace = Math.max(900, Math.min(6000, Number(opts.pace) || 2400));
      const walked = [];
      const missing = [];
      const c = cursor();
      c.style.opacity = '1';

      try {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i] || {};
          const sel = resolve(step.target);
          if (!sel) { missing.push(step.target); continue; }
          let node = null;
          try { node = document.querySelector(sel); } catch { /* invalid */ }
          if (!node) { missing.push(step.target); continue; }

          node.scrollIntoView({ block: 'center', behavior: 'smooth' });
          await wait(420, signal);

          const r = docRect(node);
          const x = r.left + Math.min(r.width / 2, 60);
          const y = r.top + r.height / 2;
          c.style.transform = `translate(${x}px, ${y}px)`;
          await wait(720, signal);
          ping(x, y);

          // Reuse the existing marks so a walkthrough leaves the same kind of
          // trace as anything else the agent does.
          const hl = api.highlight(sel, `${i + 1} of ${steps.length}`);
          const note = step.say ? api.note(sel, step.say) : null;
          walked.push({ step: i + 1, target: step.target, selector: sel });

          await wait(pace, signal);
          if (hl.ok) api.remove(hl.id);
          if (note && note.ok) api.remove(note.id);
        }
      } catch (err) {
        if (err.name !== 'AbortError') throw err;
        return { ok: false, stopped: true, walked, error: 'Walkthrough stopped.' };
      } finally {
        guideState.running = false;
        if (guideState.cursorEl) guideState.cursorEl.style.opacity = '0';
      }

      return {
        ok: true,
        walked,
        ...(missing.length ? { skipped: missing, note: 'Targets not found on this page were skipped.' } : {}),
      };
    },

    stopGuide() {
      if (!guideState.running) return { ok: false, error: 'No walkthrough running.' };
      guideState.abort.abort();
      return { ok: true, stopped: true };
    },

    /** Enter pick mode; resolves when the human clicks something or hits Escape. */
    pick(kind, opts = {}) {
      return new Promise((resolve) => {
        picker.active = true;
        picker.kind = kind;
        picker.pendingText = opts.text;
        picker.onDone = resolve;
        document.documentElement.style.cursor = 'crosshair';
      });
    },

    cancelPick() {
      const was = picker.active;
      endPick();
      return { ok: true, wasActive: was };
    },

    /** A portable record of this page's annotations plus any appearance edits. */
    exportAll() {
      const edits = window.__inscribeTinker ? window.__inscribeTinker.exportEdits() : null;
      return {
        format: 'inscribe/annotated-page@1',
        url: location.href,
        title: document.title,
        savedAt: new Date().toISOString(),
        annotations: state.marks,
        edits,
      };
    },

    importAll(data) {
      if (!data || data.format !== 'inscribe/annotated-page@1') {
        return { ok: false, error: 'Not an Inscribe annotated-page file.' };
      }
      state.marks = Array.isArray(data.annotations) ? data.annotations : [];
      state.seq = state.marks.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0);
      redraw();
      let editsRestored = false;
      if (data.edits && window.__inscribeTinker && window.__inscribeTinker.importEdits) {
        editsRestored = Boolean(window.__inscribeTinker.importEdits(data.edits).ok);
      }
      return { ok: true, annotations: state.marks.length, editsRestored, from: data.url };
    },

    highlight(target, text, color) {
      const sel = resolve(target);
      if (!sel) return { ok: false, error: `No such target: "${target}".` };
      const m = { id: ++state.seq, kind: 'highlight', selector: sel, text: text || '', color: color || '#c8552b' };
      state.marks.push(m);
      redraw();
      return { ok: true, id: m.id, kind: 'highlight', target };
    },

    note(target, text, color) {
      const sel = target ? resolve(target) : null;
      if (target && !sel) return { ok: false, error: `No such target: "${target}".` };
      const m = { id: ++state.seq, kind: 'note', selector: sel, text: String(text || ''), color: color || '#fdf6d8' };
      state.marks.push(m);
      redraw();
      return { ok: true, id: m.id, kind: 'note', target: target || '(floating)' };
    },

    arrow(fromTarget, toTarget, color) {
      const a = resolve(fromTarget);
      const b = resolve(toTarget);
      if (!a) return { ok: false, error: `No such target: "${fromTarget}".` };
      if (!b) return { ok: false, error: `No such target: "${toTarget}".` };
      const m = { id: ++state.seq, kind: 'arrow', from: a, to: b, color: color || '#c8552b' };
      state.marks.push(m);
      redraw();
      return { ok: true, id: m.id, kind: 'arrow' };
    },

    stroke(points, color, width) {
      if (!Array.isArray(points) || points.length < 2) {
        return { ok: false, error: 'points must be an array of at least two [x,y] pairs in document coordinates.' };
      }
      const m = { id: ++state.seq, kind: 'stroke', points, color: color || state.penColor, width: width || 3 };
      state.marks.push(m);
      redraw();
      return { ok: true, id: m.id, kind: 'stroke', points: points.length };
    },

    remove(id) {
      const before = state.marks.length;
      state.marks = state.marks.filter((m) => m.id !== Number(id));
      redraw();
      return { ok: state.marks.length < before, removed: before - state.marks.length };
    },

    clear() {
      const n = state.marks.length;
      state.marks = [];
      redraw();
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      return { ok: true, cleared: n };
    },

    list() {
      return state.marks.map((m) => ({
        id: m.id, kind: m.kind, text: m.text || undefined,
        target: m.selector || undefined, from: m.from, to: m.to,
      }));
    },

    /** Freehand pen for the human, not the agent. */
    setPen(on, color) {
      state.penMode = Boolean(on);
      if (color) state.penColor = color;
      const host = layer();
      host.style.pointerEvents = state.penMode ? 'auto' : 'none';
      host.style.cursor = state.penMode ? 'crosshair' : '';
      return { ok: true, penMode: state.penMode, color: state.penColor };
    },

    summary() {
      const by = {};
      for (const m of state.marks) by[m.kind] = (by[m.kind] || 0) + 1;
      return { total: state.marks.length, byKind: by, penMode: state.penMode };
    },
  };

  // Freehand capture
  let drawing = null;
  function pt(e) {
    return [Math.round(e.pageX), Math.round(e.pageY)];
  }
  document.addEventListener('pointerdown', (e) => {
    if (!state.penMode) return;
    drawing = [pt(e)];
    e.preventDefault();
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (!state.penMode || !drawing) return;
    drawing.push(pt(e));
  }, true);
  document.addEventListener('pointerup', () => {
    if (!state.penMode || !drawing) return;
    if (drawing.length > 1) api.stroke(drawing, state.penColor);
    drawing = null;
  }, true);

  // Element-anchored marks move with the page, so redraw on anything that reflows.
  let raf = null;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      if (state.marks.length) redraw();
    });
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });

  window.__inscribeAnnotate = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restore, { once: true });
  } else {
    restore();
  }
})();
