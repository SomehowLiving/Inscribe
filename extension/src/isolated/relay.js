/**
 * Inscribe — relay (ISOLATED world).
 *
 * The page world can't touch chrome.* and the extension can't touch page JS
 * objects, so this sits between them: window.postMessage on the page side,
 * a chrome.runtime port on the extension side.
 *
 * Runs in the ISOLATED world deliberately — it holds the privileged channel,
 * so page scripts must not be able to reach it.
 */
(function () {
  'use strict';

  const PAGE = 'inscribe-page';
  const EXT = 'inscribe-ext';

  const listeners = new Set();
  const state = { tools: [], siteTools: [], cosmeticTools: [], discovery: null, edits: null, stats: null, usingNative: false, log: [], port: null };

  function toPage(type, payload) {
    window.postMessage({ source: EXT, type, payload }, window.location.origin);
  }

  function emit() {
    for (const fn of listeners) {
      try {
        fn(state);
      } catch {
        /* a broken subscriber shouldn't break the relay */
      }
    }
  }

  function connect() {
    try {
      state.port = chrome.runtime.connect({ name: 'inscribe-relay' });
      state.port.onMessage.addListener((msg) => {
        if (!msg || !msg.type) return;
        if (msg.type === 'execute') toPage('execute', msg.payload);
        if (msg.type === 'scan') toPage('scan', {});
        if (msg.type === 'discover') toPage('discover', {});
        if (msg.type === 'agent-progress') {
          state.log.unshift({ ...msg.payload, time: new Date().toLocaleTimeString() });
          state.log = state.log.slice(0, 100);
          emit();
        }
      });
      state.port.onDisconnect.addListener(() => {
        state.port = null;
      });
    } catch {
      state.port = null; // service worker asleep; reconnect lazily on next send
    }
  }

  function send(type, payload) {
    if (!state.port) connect();
    try {
      state.port && state.port.postMessage({ type, payload });
    } catch {
      state.port = null;
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== PAGE) return;

    if (data.type === 'tools') {
      state.tools = data.payload.tools || [];
      state.siteTools = data.payload.siteTools || [];
      state.cosmeticTools = data.payload.cosmeticTools || [];
      state.edits = data.payload.edits || null;
      state.stats = data.payload.stats || null;
      state.usingNative = Boolean(data.payload.usingNative);
      send('tools', data.payload);
      emit();
      return;
    }

    // WebMCP discovery result — forwarded to the worker (which needs the
    // schemas to call the model) and surfaced in the panel so the trace is
    // visible rather than implied.
    if (data.type === 'discovery') {
      state.discovery = data.payload;
      send('discovery', data.payload);
      const c = data.payload.counts || {};
      state.log.unshift({
        name: 'webmcp.getTools',
        detail: `discovered ${c.site || 0} site-declared + ${c.inscribe || 0} Inscribe tool(s)`,
        time: new Date().toLocaleTimeString(),
      });
      emit();
      return;
    }

    if (data.type === 'log') {
      state.log.unshift({ ...data.payload, time: new Date().toLocaleTimeString() });
      state.log = state.log.slice(0, 100);
      emit();
      return;
    }

    if (data.type === 'confirm-request') {
      // Handed to the overlay, which is the only thing allowed to approve.
      if (window.__inscribeOverlay && window.__inscribeOverlay.askConfirm) {
        window.__inscribeOverlay.askConfirm(data.payload, (approved) => {
          toPage('confirm-response', { id: data.payload.id, approved });
          state.log.unshift({
            name: data.payload.name,
            detail: approved ? 'human approved' : 'human declined',
            time: new Date().toLocaleTimeString(),
          });
          emit();
        });
      } else {
        toPage('confirm-response', { id: data.payload.id, approved: false });
      }
      return;
    }

    if (data.type === 'execute-result') {
      send('execute-result', data.payload);
      state.log.unshift({
        name: data.payload.name,
        detail: data.payload.result && data.payload.result.isError ? 'error' : 'completed',
        time: new Date().toLocaleTimeString(),
      });
      emit();
    }
  });

  window.__inscribeRelay = {
    state,
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },
    rescan: () => toPage('scan', {}),
    discover: () => toPage('discover', {}),
    execute: (name, args, callId) => toPage('execute', { name, args, callId }),
  };

  connect();
})();
