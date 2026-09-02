/**
 * AgentForge — WebMCP bootstrap (MAIN world, document_start).
 *
 * Native WebMCP is gated behind chrome://flags/#enable-webmcp-testing or a
 * per-origin trial token that the SITE must serve. On a third-party site we
 * therefore usually find nothing, so we install a local implementation and
 * become our own agent host. If the browser does expose a complete native
 * document.modelContext, we leave it alone and use it — the site's own tools
 * are strictly better than anything we could infer.
 *
 * The surface mirrors the spec exactly: registerTool(), getTools(),
 * executeTool(), and a toolchange event. Nothing else exists in the real API.
 */
(function () {
  'use strict';

  if (window.__agentforgeBootstrapped) return;
  window.__agentforgeBootstrapped = true;

  function isComplete(value) {
    try {
      return Boolean(
        value &&
          typeof value === 'object' &&
          typeof value.registerTool === 'function' &&
          typeof value.getTools === 'function' &&
          typeof value.executeTool === 'function' &&
          typeof value.addEventListener === 'function'
      );
    } catch {
      return false;
    }
  }

  // Runtime-gated WebIDL attributes live on a prototype. Read the descriptor
  // directly so we don't recurse through a facade we may have installed.
  function readNative() {
    let proto = Object.getPrototypeOf(document);
    while (proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, 'modelContext');
      if (desc && typeof desc.get === 'function') {
        try {
          const value = desc.get.call(document);
          if (isComplete(value)) return value;
        } catch {
          /* gated off; fall through */
        }
      }
      proto = Object.getPrototypeOf(proto);
    }
    return null;
  }

  class LocalModelContext extends EventTarget {
    constructor() {
      super();
      this._tools = new Map();
    }

    registerTool(tool, options = {}) {
      if (!tool || typeof tool.name !== 'string' || !tool.name) {
        return Promise.reject(new TypeError('registerTool requires a tool with a name'));
      }
      this._tools.set(tool.name, tool);
      if (options.signal) {
        if (options.signal.aborted) {
          this._tools.delete(tool.name);
        } else {
          options.signal.addEventListener(
            'abort',
            () => {
              this._tools.delete(tool.name);
              this.dispatchEvent(new Event('toolchange'));
            },
            { once: true }
          );
        }
      }
      this.dispatchEvent(new Event('toolchange'));
      return Promise.resolve();
    }

    getTools() {
      return Promise.resolve(
        [...this._tools.values()].map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
        }))
      );
    }

    async executeTool(tool, inputObject = {}) {
      const name = tool && typeof tool === 'object' ? tool.name : tool;
      const def = this._tools.get(name);
      if (!def) throw new DOMException(`Unknown tool: ${name}`, 'NotFoundError');
      const result = await def.execute(inputObject);
      // Spec returns a DOMString; MCP-shaped content objects get serialized.
      return typeof result === 'string' ? result : JSON.stringify(result);
    }
  }

  const native = readNative();
  const local = new LocalModelContext();

  window.__agentforge = {
    native: native || null,
    local,
    // Site-declared tools (native) are authoritative; ours are supplemental.
    host: native || local,
    usingNative: Boolean(native),
  };

  if (!native) {
    try {
      Object.defineProperty(document, 'modelContext', {
        configurable: true,
        get() {
          return local;
        },
      });
    } catch {
      // Some pages freeze document; we still work via __agentforge.local.
    }
  }
})();
