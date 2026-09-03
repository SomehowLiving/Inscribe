/**
 * Inscribe — WebMCP bootstrap (MAIN world, document_start).
 *
 * Sets up TWO spec-shaped ModelContexts, because they mean different things
 * and conflating them was a real bug:
 *
 *   1. document.modelContext — THE SITE'S VOICE. Whatever the page author
 *      declared. Native when the browser supports it; otherwise we install a
 *      polyfill so a WebMCP-enabled site's own registerTool() calls still
 *      succeed on a browser without the flag. Inscribe only ever READS this.
 *      We never register our own tools here: `registerTool` is the author's
 *      channel, and writing into it makes a third party's guesses look like
 *      the site's declarations to any other agent on the page.
 *
 *   2. window.__inscribe.own — INSCRIBE'S VOICE. Tools we inferred from the
 *      DOM, plus extension-level powers (restyle, annotate) that are
 *      capabilities *over* a page rather than *of* it. Same three-method
 *      surface, so the agent discovers and invokes them identically.
 *
 * Both are real ModelContexts: registerTool(), getTools(), executeTool(),
 * toolchange. The agent path goes through getTools()/executeTool() on both —
 * it has no other way in.
 */
(function () {
  'use strict';

  if (window.__inscribeBootstrapped) return;
  window.__inscribeBootstrapped = true;

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
        // Shape follows the spec's RegisteredTool dictionary, including
        // `title` — which an agent surface may show to a human, so dropping it
        // silently degrades the UI it was added for.
        [...this._tools.values()].map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
          origin: location.origin,
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
  // The site's context: native if the browser provides it, else a polyfill so
  // the PAGE can still declare tools. Either way, read-only from our side.
  const pageContext = native || new LocalModelContext();
  // Inscribe's own context, always ours.
  const ownContext = new LocalModelContext();

  window.__inscribe = {
    native: native || null,
    page: pageContext,
    own: ownContext,
    usingNative: Boolean(native),
  };

  if (!native) {
    try {
      Object.defineProperty(document, 'modelContext', {
        configurable: true,
        get() {
          return pageContext;
        },
      });
    } catch {
      // Some pages freeze document; the site simply can't declare tools there.
    }
  }
})();
