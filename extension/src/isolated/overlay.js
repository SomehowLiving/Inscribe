/**
 * Inscribe — overlay panel (ISOLATED world).
 *
 * The human-facing half of the thesis: the agent operates the page through
 * tools, and everything it does shows up here as it happens. Rendered into a
 * closed shadow root so the host page's CSS can't restyle or hide it.
 */
(function () {
  'use strict';

  if (window.__inscribeOverlay) return;

  const host = document.createElement('div');
  host.id = '__inscribe_root';
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;right:0;';
  const root = host.attachShadow({ mode: 'closed' });

  root.innerHTML = `
    <style>
      /* Inscribe overlay — ink on paper. No gradients, no glow, no emoji:
         it should read like a printer's slip laid over the page. System serif
         only, since we can't fetch fonts on someone else's origin. */
      :host { all: initial; }
      * { box-sizing: border-box; }
      :root, .panel, .launcher, .confirm {
        --ink:#17140f; --raise:#1e1a14; --sink:#100e0a;
        --rule:#302a21; --soft:#241f19;
        --paper:#ece5d8; --mute:#a2988a; --faint:#6e665a;
        --red:#c8552b; --sage:#8a9a72; --amber:#c79a3e; --blood:#b0453a;
        --serif:'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;
        --sans:'IBM Plex Sans',ui-sans-serif,system-ui,sans-serif;
        --mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
      }
      .launcher {
        position:fixed; top:14px; right:14px; width:34px; height:34px;
        background:var(--ink); border:1px solid var(--rule); cursor:pointer;
        color:var(--red); font-family:var(--serif); font-size:20px; line-height:1;
        display:grid; place-items:center; border-radius:2px;
        box-shadow:0 2px 10px rgba(0,0,0,.4);
      }
      .launcher:hover { border-color:var(--faint); }
      .panel {
        position:fixed; top:14px; right:14px; width:376px; max-height:88vh;
        display:flex; flex-direction:column; overflow:hidden;
        background:var(--ink); color:var(--paper);
        border:1px solid var(--rule); border-top:2px solid var(--red);
        border-radius:2px; box-shadow:0 10px 34px rgba(0,0,0,.5);
        font-family:var(--sans); font-size:12.5px; line-height:1.5;
        background-image:repeating-linear-gradient(90deg,rgba(236,229,216,.014) 0 1px,transparent 1px 3px);
      }
      header {
        display:flex; align-items:center; justify-content:space-between;
        padding:9px 12px; border-bottom:1px solid var(--soft); background:var(--sink);
      }
      .title { display:flex; align-items:baseline; gap:8px; }
      .title b { font-family:var(--serif); font-weight:400; font-size:17px; letter-spacing:.005em; }
      .nib { width:6px; height:6px; background:var(--sage);
        clip-path:polygon(50% 0,100% 100%,0 100%); align-self:center; }
      .native { font-family:var(--mono); font-size:9px; letter-spacing:.11em;
        text-transform:uppercase; color:var(--faint); }
      .x { background:none;border:none;color:var(--faint);cursor:pointer;
        font-family:var(--mono);font-size:14px; }
      .x:hover { color:var(--red); }
      .body { overflow-y:auto; padding:0 12px 12px; }
      h4 { margin:14px 0 8px; font-size:9px; font-weight:600;
        letter-spacing:.16em; text-transform:uppercase; color:var(--faint);
        display:flex; justify-content:space-between; align-items:center;
        padding-bottom:6px; border-bottom:1px solid var(--soft); }
      h4 span { font-family:var(--mono); font-size:10px; color:var(--red);
        letter-spacing:0; font-variant-numeric:tabular-nums; }
      .tool { padding:8px 0; border-bottom:1px solid var(--soft); }
      .tool:last-child { border-bottom:none; }
      .tool .n { font-family:var(--mono); font-size:11px; color:var(--paper); word-break:break-all; }
      .tool .n::before { content:'\\00a7 '; color:var(--red); }
      .tool .d { color:var(--faint); margin-top:3px; font-size:11px; line-height:1.45; }
      .row { display:flex; gap:6px; align-items:center; margin-top:6px; flex-wrap:wrap; }
      .badge { font-family:var(--mono); font-size:9px; letter-spacing:.06em;
        text-transform:uppercase; padding:1px 5px; border:1px solid; }
      .declared { color:var(--sage); border-color:rgba(138,154,114,.45); }
      .ext { color:#8fb4c9; border-color:rgba(143,180,201,.45); }
      .ro { color:var(--faint); border-color:var(--rule); }
      .inferred { color:var(--amber); border-color:rgba(199,154,62,.45); }
      .sens { color:#d99a92; border-color:rgba(176,69,58,.5); }
      .conf { margin-left:auto; font-family:var(--mono); font-size:9.5px;
        color:var(--faint); font-variant-numeric:tabular-nums; }
      .empty { color:var(--faint); padding:9px 0; font-size:11.5px;
        line-height:1.55; font-style:italic; }
      .log { font-family:var(--mono); font-size:10.5px; }
      .log div { display:flex; gap:7px; padding:4px 0 4px 8px;
        border-left:2px solid var(--rule); color:var(--mute); }
      .log .t { color:var(--faint); flex:none; font-variant-numeric:tabular-nums; }
      .confirm { position:fixed; inset:0; background:rgba(16,14,10,.86);
        display:grid; place-items:center; padding:18px; }
      .card { background:var(--ink); border:1px solid var(--rule);
        border-top:2px solid var(--amber); border-radius:2px;
        padding:20px 22px; width:340px; box-shadow:0 12px 34px rgba(0,0,0,.55);
        font-family:var(--sans); }
      .card h3 { margin:0 0 9px; font-family:var(--serif); font-weight:400;
        font-size:19px; color:var(--paper); }
      .card p { margin:0 0 11px; color:var(--mute); line-height:1.55; font-size:12px; }
      .card pre { background:var(--sink); border:1px solid var(--soft);
        padding:8px 9px; font-family:var(--mono); font-size:10px; overflow:auto;
        max-height:130px; color:var(--mute); margin:0 0 14px; border-radius:2px; }
      .acts { display:flex; gap:8px; justify-content:flex-end; }
      button.b { padding:6px 13px; font-family:var(--sans); font-size:12px;
        border:1px solid var(--rule); background:transparent; color:var(--paper);
        border-radius:2px; cursor:pointer; }
      button.b:hover { border-color:var(--faint); }
      button.ok { background:var(--red); border-color:var(--red);
        color:#17140f; font-weight:600; }
      .hidden { display:none !important; }
      footer { padding:9px 12px 11px; border-top:1px solid var(--soft);
        background:var(--sink); display:flex; flex-direction:column; gap:7px; }
      .frow { display:flex; gap:7px; }
      .tools { flex-wrap:wrap; gap:5px; }
      .tools button { flex:0 0 auto; padding:4px 8px; font-size:10.5px;
        font-family:var(--mono); letter-spacing:.03em; }
      .tools button.on { background:var(--red); border-color:var(--red);
        color:#17140f; font-weight:600; }
      footer button { padding:6px 10px; font-family:var(--sans); font-size:11.5px;
        border:1px solid var(--rule); background:transparent; color:var(--mute);
        border-radius:2px; cursor:pointer; white-space:nowrap; flex:0 0 auto; }
      footer button:hover { border-color:var(--faint); color:var(--paper); }
      footer button:disabled { opacity:.4; cursor:not-allowed; }
      #run { background:var(--red); border-color:var(--red); color:#17140f; font-weight:600; }
      #goal { flex:1; min-width:0; background:var(--ink); border:1px solid var(--rule);
        border-radius:2px; color:var(--paper); font-family:var(--sans);
        font-size:12.5px; padding:7px 9px; outline:none; }
      #goal::placeholder { color:var(--faint); font-style:italic; }
      #goal:focus { border-color:var(--red); }
      #model { background:var(--ink); border:1px solid var(--rule); border-radius:2px;
        color:var(--mute); font-family:var(--mono); font-size:10px;
        padding:5px 6px; flex:1 1 auto; min-width:0; max-width:150px; outline:none; }
      #model:focus { border-color:var(--red); }
      #status { font-family:var(--mono); font-size:10px; color:var(--faint);
        min-height:13px; line-height:1.4; }
      #status.err { color:#d99a92; }
      #status.ok { color:var(--sage); }
    </style>
    <button class="launcher" title="Inscribe">I</button>
    <div class="panel hidden">
      <header>
        <div class="title"><span class="nib"></span><b>Inscribe</b><span class="native" id="mode"></span></div>
        <button class="x" title="Close">×</button>
      </header>
      <div class="body">
        <h4>Declared by this website <span id="cs">0</span></h4>
        <div id="site"></div>
        <h4>Inferred by Inscribe from the page <span id="cc">0</span></h4>
        <div id="tools"></div>
        <h4>Inscribe capabilities <span id="ce">0 edits</span></h4>
        <div id="cosmetic"></div>
        <h4>Activity</h4>
        <div class="log" id="log"></div>
      </div>
      <footer>
        <div class="frow tools">
          <button id="t-pen" title="Freehand pen">Pen</button>
          <button id="t-hi" title="Click an element to highlight it">Highlight</button>
          <button id="t-note" title="Click an element to attach a note">Note</button>
          <button id="t-clear" title="Remove all annotations">Clear</button>
          <button id="t-exp" title="Export annotations + edits">Export</button>
          <button id="t-imp" title="Import a saved record">Import</button>
        </div>
        <div class="frow">
          <input id="goal" type="text" autocomplete="off"
                 placeholder="Tell the agent what to do on this page…" />
          <button id="run">Run</button>
        </div>
        <div class="frow">
          <select id="model" title="Model"></select>
          <button id="undo" title="Undo the last appearance change">Undo</button>
          <button id="reset" title="Restore this site">Reset</button>
          <button id="rescan">Scan</button>
          <button id="stop" disabled>Stop</button>
        </div>
        <div id="status"></div>
      </footer>
    </div>
    <div class="confirm hidden" id="confirm">
      <div class="card">
        <h3>This one was inferred</h3>
        <p id="cmsg"></p>
        <pre id="cargs"></pre>
        <div class="acts">
          <button class="b no" id="cno">Decline</button>
          <button class="b ok" id="cyes">Allow once</button>
        </div>
      </div>
    </div>
  `;

  const $ = (s) => root.querySelector(s);
  const panel = $('.panel');
  const launcher = $('.launcher');

  launcher.onclick = () => {
    panel.classList.remove('hidden');
    launcher.classList.add('hidden');
    // Populate the trace via real WebMCP discovery rather than a cached list.
    if (window.__inscribeRelay) window.__inscribeRelay.discover();
  };
  $('.x').onclick = () => { panel.classList.add('hidden'); launcher.classList.remove('hidden'); };
  $('#rescan').onclick = () => window.__inscribeRelay && window.__inscribeRelay.rescan();

  function page(action, payload) {
    window.postMessage({ source: 'inscribe-ext', type: 'annotate', payload: { action, ...payload } }, location.origin);
  }

  // The page world hands back an export for us to save as a file.
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'inscribe-page' || d.type !== 'annotate-export') return;
    try {
      const blob = new Blob([JSON.stringify(d.payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `inscribe-${location.hostname}-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setStatus('Exported.', 'ok');
    } catch (err) {
      setStatus(`Export failed: ${err.message}`, 'err');
    }
  });

  function cosmetic(name) {
    // Tier-one tools need no gate, so call them straight down the execute channel.
    if (window.__inscribeRelay) {
      window.__inscribeRelay.execute(name, {}, `ui_${Date.now()}`);
      setTimeout(() => window.__inscribeRelay.rescan(), 250);
    }
  }
  // Drawing straight from the toolbar — no agent, no tokens.
  let penOn = false;
  $('#t-pen').onclick = () => {
    penOn = !penOn;
    $('#t-pen').classList.toggle('on', penOn);
    page('pen', { on: penOn });
    setStatus(penOn ? 'Pen on \u2014 drag on the page to draw.' : 'Pen off.');
  };
  $('#t-hi').onclick = () => {
    setStatus('Click an element on the page to highlight it (Esc to cancel).');
    page('pick', { kind: 'highlight' });
  };
  $('#t-note').onclick = () => {
    const text = prompt('Note text:');
    if (text == null) return;
    setStatus('Click the element this note belongs to (Esc to cancel).');
    page('pick', { kind: 'note', text });
  };
  $('#t-clear').onclick = () => { page('clearMarks', {}); setStatus('Annotations cleared.', 'ok'); };
  $('#t-exp').onclick = () => page('export', {});
  $('#t-imp').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      try {
        page('import', { data: JSON.parse(await f.text()) });
        setStatus(`Imported ${f.name}.`, 'ok');
      } catch (err) {
        setStatus(`Could not read that file: ${err.message}`, 'err');
      }
    };
    inp.click();
  };

  $('#undo').onclick = () => cosmetic('inscribe.ui.undo');
  $('#reset').onclick = () => {
    setStatus('Restored this site to normal.', 'ok');
    cosmetic('inscribe.ui.reset');
  };

  function setStatus(text, cls) {
    const el = $('#status');
    el.className = cls || '';
    el.textContent = text || '';
  }

  let running = false;
  function setRunning(on) {
    running = on;
    $('#run').disabled = on;
    $('#goal').disabled = on;
    $('#model').disabled = on;
    $('#stop').disabled = !on;
  }

  async function loadModels() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_MODELS' });
      const sel = $('#model');
      sel.textContent = '';
      const models = (res && res.models) || [];
      if (!models.length) {
        const o = document.createElement('option');
        o.textContent = 'No model configured';
        o.disabled = true;
        sel.appendChild(o);
        $('#run').disabled = true;
        setStatus('No model provider reachable — the agent backend has no keys configured.', 'err');
        return;
      }
      for (const m of models) {
        const o = document.createElement('option');
        o.value = m.id;
        o.textContent = m.label;
        sel.appendChild(o);
      }
    } catch (err) {
      setStatus(`Could not load models: ${err.message}`, 'err');
    }
  }

  async function run() {
    const goal = $('#goal').value.trim();
    const model = $('#model').value;
    if (!goal || running) return;

    setRunning(true);
    setStatus('Starting…');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'RUN_AGENT', goal, model });
      if (!res) {
        setStatus('No response from the extension worker.', 'err');
      } else if (res.ok) {
        setStatus(res.text ? res.text.slice(0, 400) : 'Done.', 'ok');
        $('#goal').value = '';
      } else {
        setStatus(res.error || 'Agent failed.', 'err');
      }
    } catch (err) {
      setStatus(err.message, 'err');
    } finally {
      setRunning(false);
    }
  }

  $('#run').onclick = run;
  $('#goal').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); run(); }
  });
  // The worker owns the loop, so "stop" abandons the UI wait rather than
  // pretending to cancel mid-flight — honest about what it does.
  $('#stop').onclick = () => {
    setRunning(false);
    setStatus('Stopped watching. A step already in flight may still finish.', 'err');
  };

  function provenanceCard(t) {
    const el = document.createElement('div');
    el.className = 'tool';
    const n = document.createElement('div');
    n.className = 'n';
    n.textContent = t.name;
    const d = document.createElement('div');
    d.className = 'd';
    d.textContent = t.title || t.description || '';
    const row = document.createElement('div');
    row.className = 'row';
    const p = PROVENANCE[t.provenance] || { label: t.provenance, cls: 'inferred' };
    const badge = document.createElement('span');
    badge.className = `badge ${p.cls}`;
    badge.textContent = p.label;
    row.appendChild(badge);
    if (t.annotations && t.annotations.readOnlyHint) {
      const ro = document.createElement('span');
      ro.className = 'badge ro';
      ro.textContent = 'read-only';
      row.appendChild(ro);
    }
    const ctx = document.createElement('span');
    ctx.className = 'conf';
    ctx.textContent = t.context;
    row.appendChild(ctx);
    el.append(n, d, row);
    return el;
  }

  function renderLog(state) {
    const log = $('#log');
    log.textContent = '';
    if (!state.log.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'No tool calls yet.';
      log.appendChild(e);
      return;
    }
    for (const l of state.log.slice(0, 40)) {
      const div = document.createElement('div');
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = l.time || '';
      const m = document.createElement('span');
      m.textContent = `${l.name} — ${l.detail}`;
      div.append(t, m);
      log.appendChild(div);
    }
  }

  function toolCard(t) {
    const el = document.createElement('div');
    el.className = 'tool';
    const n = document.createElement('div');
    n.className = 'n';
    n.textContent = t.name;
    const d = document.createElement('div');
    d.className = 'd';
    d.textContent = t.description || '';
    const row = document.createElement('div');
    row.className = 'row';
    const trust = document.createElement('span');
    trust.className = `badge ${t.trust === 'declared' ? 'declared' : 'inferred'}`;
    trust.textContent = t.trust === 'declared' ? 'declared' : 'inferred · needs confirm';
    row.appendChild(trust);
    if (t.sensitive) {
      const s = document.createElement('span');
      s.className = 'badge sens';
      s.textContent = 'sensitive';
      row.appendChild(s);
    }
    if (typeof t.confidence === 'number') {
      const c = document.createElement('span');
      c.className = 'conf';
      c.textContent = `${Math.round(t.confidence * 100)}%`;
      row.appendChild(c);
    }
    el.append(n, d, row);
    return el;
  }

  const PROVENANCE = {
    'site-declared': { label: 'declared by site', cls: 'declared' },
    'inferred-from-dom': { label: 'inferred · needs confirm', cls: 'inferred' },
    'inscribe-extension': { label: 'Inscribe capability', cls: 'ext' },
  };

  function render(state) {
    $('#mode').textContent = state.usingNative ? 'native WebMCP' : 'polyfilled';

    // Provenance comes from WHICH ModelContext answered getTools(), so the
    // panel cannot claim a site declared something it didn't.
    const d = state.discovery;
    if (d) {
      const declared = d.site || [];
      const fromCtx = d.inscribe || [];
      const inferred = fromCtx.filter((t) => t.provenance === 'inferred-from-dom');
      const ours = fromCtx.filter((t) => t.provenance === 'inscribe-extension');

      const fill = (sel, list, empty) => {
        const host = $(sel);
        host.textContent = '';
        if (!list.length) {
          const e = document.createElement('div');
          e.className = 'empty';
          e.textContent = empty;
          host.appendChild(e);
          return;
        }
        for (const t of list) host.appendChild(provenanceCard(t));
      };

      $('#cs').textContent = String(declared.length);
      fill('#site', declared,
        'None. This site does not speak WebMCP, so Inscribe falls back to inferring capabilities from its markup.');
      $('#cc').textContent = String(inferred.length);
      fill('#tools', inferred, 'Nothing inferable — no labelled forms or named controls outside navigation.');
      fill('#cosmetic', ours, 'Tinker engine not loaded on this page.');
      const e = state.edits;
      const n = e ? e.restyled + e.hidden + e.retexted + (e.swappedImages || 0) : 0;
      $('#ce').textContent = `${n} edit${n === 1 ? '' : 's'}`;

      renderLog(state);
      return;
    }

    const site = $('#site');
    site.textContent = '';
    $('#cs').textContent = String(state.siteTools.length);
    if (!state.siteTools.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'None. This site does not expose its own WebMCP tools, so the ones below were inferred from its markup.';
      site.appendChild(e);
    } else {
      state.siteTools.forEach((t) => site.appendChild(toolCard(t)));
    }

    const tools = $('#tools');
    tools.textContent = '';
    $('#cc').textContent = String(state.tools.length);
    if (!state.tools.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'Nothing synthesizable found — no labelled forms or named controls outside navigation.';
      tools.appendChild(e);
    } else {
      state.tools.forEach((t) => tools.appendChild(toolCard(t)));
    }

    const log = $('#log');
    log.textContent = '';
    if (!state.log.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'No tool calls yet.';
      log.appendChild(e);
    } else {
      state.log.slice(0, 40).forEach((l) => {
        const d = document.createElement('div');
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = l.time || '';
        const m = document.createElement('span');
        m.textContent = `${l.name} — ${l.detail}`;
        d.append(t, m);
        log.appendChild(d);
      });
    }
  }

  let pendingConfirm = null;
  function askConfirm(payload, done) {
    pendingConfirm = done;
    $('#cmsg').textContent =
      `Inscribe inferred "${payload.name}" from this page's markup (${Math.round((payload.confidence || 0) * 100)}% confidence). ` +
      `It was not declared by the site, so it needs your approval before it touches anything.`;
    $('#cargs').textContent = JSON.stringify(payload.args || {}, null, 2);
    $('#confirm').classList.remove('hidden');
    panel.classList.remove('hidden');
    launcher.classList.add('hidden');
  }

  function settle(approved) {
    $('#confirm').classList.add('hidden');
    const done = pendingConfirm;
    pendingConfirm = null;
    if (done) done(approved);
  }
  $('#cyes').onclick = () => settle(true);
  $('#cno').onclick = () => settle(false);

  window.__inscribeOverlay = { askConfirm, toggle: () => launcher.click() };

  function mount() {
    (document.body || document.documentElement).appendChild(host);
    if (window.__inscribeRelay) window.__inscribeRelay.subscribe(render);
    loadModels();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
