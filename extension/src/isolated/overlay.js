/**
 * AgentForge — overlay panel (ISOLATED world).
 *
 * The human-facing half of the thesis: the agent operates the page through
 * tools, and everything it does shows up here as it happens. Rendered into a
 * closed shadow root so the host page's CSS can't restyle or hide it.
 */
(function () {
  'use strict';

  if (window.__agentforgeOverlay) return;

  const host = document.createElement('div');
  host.id = '__agentforge_root';
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;right:0;';
  const root = host.attachShadow({ mode: 'closed' });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
      .launcher {
        position: fixed; top: 12px; right: 12px; width: 40px; height: 40px;
        border-radius: 10px; border: 1px solid #2a2a3a; cursor: pointer;
        background: linear-gradient(135deg, #0d0d14, #16161f); color: #00d4ff;
        font-size: 17px; display: grid; place-items: center;
        box-shadow: 0 6px 20px rgba(0,0,0,.45);
      }
      .panel {
        position: fixed; top: 12px; right: 12px; width: 360px; max-height: 86vh;
        display: flex; flex-direction: column; overflow: hidden;
        background: #0b0b11; color: #e6e6ee; border: 1px solid #2a2a3a;
        border-radius: 12px; box-shadow: 0 18px 50px rgba(0,0,0,.55); font-size: 12px;
      }
      header { display:flex; align-items:center; justify-content:space-between;
        padding: 9px 11px; border-bottom: 1px solid #2a2a3a; background: #10101a; }
      .title { display:flex; align-items:center; gap:7px; font-weight:650; font-size:12px; }
      .dot { width:7px; height:7px; border-radius:50%; background:#00ff88; box-shadow:0 0 7px #00ff88; }
      .native { font-size:9px; text-transform:uppercase; letter-spacing:.08em;
        padding:2px 6px; border-radius:4px; background:#1b1b28; color:#8b8ba7; }
      .x { background:none;border:none;color:#8b8ba7;cursor:pointer;font-size:15px; }
      .body { overflow-y:auto; padding: 9px 11px; }
      h4 { margin: 8px 0 6px; font-size:9.5px; text-transform:uppercase;
        letter-spacing:.09em; color:#8b8ba7; display:flex; justify-content:space-between; }
      .tool { border:1px solid #23232f; background:#101019; border-radius:7px;
        padding:7px 8px; margin-bottom:5px; }
      .tool .n { font-family: ui-monospace, monospace; color:#00d4ff; font-size:11px;
        word-break:break-all; }
      .tool .d { color:#9b9bb3; margin-top:2px; line-height:1.35; }
      .row { display:flex; gap:4px; align-items:center; margin-top:5px; flex-wrap:wrap; }
      .badge { font-size:9px; padding:1.5px 5px; border-radius:4px; border:1px solid transparent; }
      .declared { background:rgba(0,255,136,.1); color:#00ff88; border-color:rgba(0,255,136,.3); }
      .inferred { background:rgba(255,170,0,.1); color:#ffaa00; border-color:rgba(255,170,0,.3); }
      .sens { background:rgba(255,68,68,.1); color:#ff6b6b; border-color:rgba(255,68,68,.3); }
      .conf { color:#7a7a94; font-size:9px; margin-left:auto; }
      .empty { color:#6f6f88; padding:10px 0; line-height:1.5; }
      .log { font-family: ui-monospace, monospace; font-size:10px; }
      .log div { padding:4px 6px; border-left:2px solid #2a2a3a; background:#0f0f17;
        margin-bottom:3px; border-radius:0 4px 4px 0; }
      .log .t { color:#6f6f88; margin-right:6px; }
      .confirm { position:fixed; inset:0; background:rgba(0,0,0,.72);
        display:grid; place-items:center; padding:16px; }
      .card { background:#12121c; border:1px solid #3a3a52; border-radius:11px;
        padding:15px; width:330px; box-shadow:0 20px 50px rgba(0,0,0,.6); }
      .card h3 { margin:0 0 8px; font-size:13px; color:#ffaa00; }
      .card p { margin:0 0 9px; color:#b9b9cd; line-height:1.45; font-size:11.5px; }
      .card pre { background:#0b0b12; border:1px solid #23232f; border-radius:6px;
        padding:7px; font-size:10px; overflow:auto; max-height:130px; color:#c8c8dc; margin:0 0 11px; }
      .acts { display:flex; gap:7px; justify-content:flex-end; }
      button.b { padding:6px 12px; border-radius:6px; font-size:11.5px; cursor:pointer;
        border:1px solid #2a2a3a; background:#1a1a26; color:#e6e6ee; }
      button.ok { background:rgba(0,212,255,.14); border-color:#00d4ff; color:#00d4ff; font-weight:600; }
      button.no { background:transparent; }
      .hidden { display:none !important; }
      footer { padding:7px 11px; border-top:1px solid #2a2a3a; background:#10101a;
        display:flex; gap:7px; }
      footer button { flex:1; padding:5px; font-size:11px; border-radius:6px;
        border:1px solid #2a2a3a; background:#1a1a26; color:#c8c8dc; cursor:pointer; }
    </style>
    <button class="launcher" title="AgentForge">◆</button>
    <div class="panel hidden">
      <header>
        <div class="title"><span class="dot"></span> AgentForge <span class="native" id="mode"></span></div>
        <button class="x" title="Close">×</button>
      </header>
      <div class="body">
        <h4>Site-declared tools <span id="cs">0</span></h4>
        <div id="site"></div>
        <h4>Synthesized from this page <span id="cc">0</span></h4>
        <div id="tools"></div>
        <h4>Activity</h4>
        <div class="log" id="log"></div>
      </div>
      <footer>
        <button id="rescan">Re-scan page</button>
      </footer>
    </div>
    <div class="confirm hidden" id="confirm">
      <div class="card">
        <h3>Confirm inferred action</h3>
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

  launcher.onclick = () => { panel.classList.remove('hidden'); launcher.classList.add('hidden'); };
  $('.x').onclick = () => { panel.classList.add('hidden'); launcher.classList.remove('hidden'); };
  $('#rescan').onclick = () => window.__agentforgeRelay && window.__agentforgeRelay.rescan();

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

  function render(state) {
    $('#mode').textContent = state.usingNative ? 'native WebMCP' : 'polyfilled';

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
      `AgentForge inferred "${payload.name}" from this page's markup (${Math.round((payload.confidence || 0) * 100)}% confidence). ` +
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

  window.__agentforgeOverlay = { askConfirm, toggle: () => launcher.click() };

  function mount() {
    (document.body || document.documentElement).appendChild(host);
    if (window.__agentforgeRelay) window.__agentforgeRelay.subscribe(render);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
