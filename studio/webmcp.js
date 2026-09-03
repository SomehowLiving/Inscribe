/**
 * Inscribe — WebMCP tool registry.
 *
 * Exposes the whole IDE as `inscribe.*` tools over the W3C WebMCP surface.
 * `document.modelContext` is the canonical API in the current spec
 * (webmachinelearning/webmcp, Chrome 149 / Edge 150 origin trials), so it is
 * preferred; `navigator.modelContext` is checked only as a fallback for
 * older polyfills that shipped against the earlier shape.
 * When neither is present (plain browser, no extension/polyfill installed)
 * tools are still registered against a local in-page registry so the
 * Inspector panel and demo agent work standalone.
 */
(function () {
  function getModelContext() {
    if (typeof document !== 'undefined' && document.modelContext) return document.modelContext;
    if (typeof navigator !== 'undefined' && navigator.modelContext) return navigator.modelContext;
    return null;
  }

  // Mirrors the real ModelContext surface, which is exactly three methods
  // plus a toolchange event: registerTool(), getTools(), executeTool().
  // (provideContext/unregisterTool/clearContext/availableTools are stale
  // 2025-draft names that never shipped — deliberately not implemented.)
  // Unregistration follows the spec: pass an AbortSignal via options.
  class LocalRegistry {
    constructor() {
      this.tools = new Map();
    }
    registerTool(def, options = {}) {
      this.tools.set(def.name, def);
      if (options.signal) {
        options.signal.addEventListener('abort', () => this.tools.delete(def.name), { once: true });
      }
      return Promise.resolve();
    }
    getTools() {
      // Spec RegisteredTool projection, so consumers see the same shape a
      // native implementation would hand back.
      return Promise.resolve(
        [...this.tools.values()].map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
          origin: location.origin,
        }))
      );
    }
    executeTool(tool, inputObject = {}) {
      // Handles from getTools() are projections, so resolve by name.
      const def = this.tools.get(tool && tool.name ? tool.name : tool);
      if (!def) {
        return Promise.reject(new DOMException(`Unknown tool: ${tool && tool.name ? tool.name : tool}`, 'NotFoundError'));
      }
      // Spec: executeTool resolves to a DOMString. Returning the raw object
      // made every result stringify to "[object Object]" for any consumer that
      // took the contract at its word.
      return Promise.resolve(def.execute(inputObject)).then((r) =>
        typeof r === 'string' ? r : JSON.stringify(r)
      );
    }
  }

  class InscribeWebMCP {
    constructor(vfs, app) {
      this.vfs = vfs;
      this.app = app;
      this.logs = [];
      this.registrations = [];
      this.handlers = new Map();

      const host = getModelContext();
      if (host) {
        this.host = host;
        this.usingPolyfillFallback = false;
      } else {
        // No native WebMCP here. Install our registry ON document.modelContext
        // rather than keeping it private: Inscribe IS this site, so these are
        // genuinely its declared capabilities, and any agent that visits — the
        // built-in one, ChatGPT Desktop, our own — should find them at the
        // standard location instead of a place only we know about.
        this.host = new LocalRegistry();
        this.usingPolyfillFallback = true;
        try {
          Object.defineProperty(document, 'modelContext', {
            configurable: true,
            get: () => this.host,
          });
        } catch {
          // Frozen document: tools still work for our own agent.
        }
      }

      this.registerAll();
    }

    log(message, type = 'info') {
      const entry = { time: new Date().toLocaleTimeString(), message, type };
      this.logs.unshift(entry);
      this.logs = this.logs.slice(0, 200);
      if (this.app) this.app.updateLog(this.logs);
      if (type === 'error') console.error('[forge]', message);
    }

    clearLog() {
      this.logs = [];
      if (this.app) this.app.updateLog(this.logs);
    }

    /**
     * @param opts {{ title?, readOnly?, consequential?, untrustedOutput? }}
     *   consequential — irreversible or externally visible (deploy, delete,
     *   shell). Chrome's guidance is explicit: don't let an agent auto-submit
     *   these. They now require a human click that the agent cannot make.
     */
    define(name, description, inputSchema, handler, opts = {}) {
      const wrapped = async (args) => {
        this.log(`→ ${name}(${JSON.stringify(args || {})})`, 'call');
        try {
          if (opts.consequential) {
            const ok = await this.app.confirmConsequential(name, args || {});
            if (!ok) {
              this.log(`✗ ${name}: declined by human`, 'warning');
              return {
                content: [{ type: 'text', text: `Refused: "${name}" is irreversible and the human declined it.` }],
                isError: true,
              };
            }
          }
          const result = await handler(args || {});
          this.log(`✓ ${name}`, 'success');
          return result;
        } catch (err) {
          this.log(`✗ ${name}: ${err.message}`, 'error');
          throw err;
        }
      };

      this.handlers.set(name, wrapped);

      let reg;
      try {
        reg = this.host.registerTool({
          name,
          title: opts.title || name.split('.').slice(1).join(' '),
          description,
          inputSchema,
          annotations: {
            readOnlyHint: Boolean(opts.readOnly),
            untrustedContentHint: Boolean(opts.untrustedOutput),
          },
          async execute(args) {
            return wrapped(args);
          },
          // Some polyfills expect `call` instead of `execute` — provide both.
          async call(args) {
            return wrapped(args);
          },
        });
      } catch (err) {
        // Synchronous throw (older polyfills).
        this.log(`✗ register ${name}: ${err.message}`, 'error');
      }

      // Per spec, document.modelContext.registerTool() returns a Promise that
      // rejects with NotAllowedError when the `tools` permission policy denies
      // it. Older polyfills and our local registry return a plain handle, so
      // handle both rather than leaving an unhandled rejection.
      if (reg && typeof reg.then === 'function') {
        reg.catch((err) => {
          this.log(`✗ register ${name}: ${err.name || 'Error'} — ${err.message}`, 'error');
        });
      }

      this.registrations.push({ name, title: opts.title, description, inputSchema, opts, reg });
    }

    getToolList() {
      return this.registrations.map(({ name, description }) => ({ name, description }));
    }

    // Full {name, description, inputSchema} for handing to a real LLM as tool defs.
    getToolSchemas() {
      const out = {};
      for (const { name, description, inputSchema } of this.registrations) {
        out[name] = { description, inputSchema };
      }
      return out;
    }

    // Actually runs a tool by name — this is real execution against the VFS
    // and UI, the same handler WebMCP itself calls, usable directly by an
    // in-page LLM-driven agent (no host/extension required).
    async callTool(name, args) {
      const handler = this.handlers.get(name);
      if (!handler) throw new Error(`Unknown tool: ${name}`);
      return handler(args || {});
    }

    registerAll() {
      const vfs = this.vfs;
      const app = this.app;

      this.define(
        'inscribe.file.list',
        'List files and directories under a given path.',
        { type: 'object', properties: { path: { type: 'string' } } },
        ({ path }) => vfs.list(path || '/'),
        { title: 'List files', readOnly: true }
      );

      this.define(
        'inscribe.file.read',
        'Read the contents of a single file.',
        { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        ({ path }) => vfs.read(path),
        { title: 'Read a file', readOnly: true }
      );

      this.define(
        'inscribe.file.write',
        'Create or overwrite a file with new content.',
        {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content'],
        },
        ({ path, content }) => vfs.write(path, content)
      );

      this.define(
        'inscribe.file.delete',
        'Delete a file or directory (recursively).',
        { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        ({ path }) => vfs.delete(path),
        { title: 'Delete a file', consequential: true }
      );

      this.define(
        'inscribe.file.mkdir',
        'Create a directory.',
        { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        ({ path }) => vfs.mkdir(path)
      );

      this.define(
        'inscribe.code.execute',
        'Execute a JavaScript snippet in the sandboxed preview iframe and return console output plus the result.',
        { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
        ({ code }) => this.executeInSandbox(code)
      );

      this.define(
        'inscribe.preview.refresh',
        'Re-render the live preview from the current project files.',
        { type: 'object', properties: { path: { type: 'string' } } },
        ({ path }) => {
          app.refreshPreview(path || '/project');
          return { ok: true };
        }
      );

      this.define(
        'inscribe.terminal.exec',
        'Actually run a shell command, isolated in an ephemeral Vercel Sandbox VM (not this server), and print its real output to the Terminal panel.',
        { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
        ({ command }) => this.execCommand(command),
        { title: 'Run a shell command', consequential: true, untrustedOutput: true }
      );

      this.define(
        'inscribe.chat.send',
        'Post a message into the Agent Chat panel, visible to the human.',
        {
          type: 'object',
          properties: {
            message: { type: 'string' },
            type: { type: 'string', enum: ['info', 'success', 'warning', 'error'] },
          },
          required: ['message'],
        },
        ({ message, type }) => {
          app.showChatMessage(message, type || 'info');
          return { ok: true };
        }
      );

      this.define(
        'inscribe.system.info',
        'Return metadata about this Inscribe instance and available tools.',
        { type: 'object', properties: {} },
        () => ({
          name: 'Inscribe',
          version: '1.0.0',
          webmcpHost: this.usingPolyfillFallback ? 'local-fallback' : 'native-or-polyfill',
          toolCount: this.registrations.length,
        }),
        { title: 'Environment info', readOnly: true }
      );

      this.define(
        'inscribe.image.generate',
        'Generate a real image from a prompt (via an OpenRouter image model) and save it into the project. Falls back to a placeholder SVG gradient if no image model is configured or the call fails.',
        {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
            filename: { type: 'string' },
            dir: { type: 'string' },
          },
          required: ['prompt', 'filename'],
        },
        ({ prompt, filename, dir }) => this.generateImage(prompt, filename, dir || '/project')
      );

      this.define(
        'inscribe.deploy',
        'Deploy the current project to a live Vercel URL. Falls back to a downloadable file-bundle summary if no deploy backend is configured.',
        {
          type: 'object',
          properties: { path: { type: 'string' }, name: { type: 'string' } },
        },
        ({ path, name }) => this.deployProject(path || '/project', name),
        { title: 'Publish to a live URL', consequential: true }
      );
    }

    executeInSandbox(code) {
      return new Promise((resolve) => {
        const frame = document.getElementById('sandbox-frame');
        if (!frame || !frame.contentWindow) {
          resolve({ error: 'Sandbox frame not ready' });
          return;
        }
        const onMessage = (e) => {
          if (e.data && e.data.type === 'forge-code-result') {
            window.removeEventListener('message', onMessage);
            resolve({ result: e.data.result, error: e.data.error, logs: e.data.logs });
          }
        };
        window.addEventListener('message', onMessage);
        frame.contentWindow.postMessage({ type: 'forge-code-execute', code }, '*');
        setTimeout(() => {
          window.removeEventListener('message', onMessage);
          resolve({ error: 'Execution timed out' });
        }, 5000);
      });
    }

    async deployProject(dir, name) {
      const files = this.vfs.exportProject(dir);
      const fileCount = Object.keys(files).length;

      if (fileCount === 0) {
        return { error: `No files found under ${dir}` };
      }

      try {
        const resp = await fetch('/api/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files, name }),
        });
        const data = await resp.json();

        if (resp.status === 501) {
          this.app.showChatMessage(
            `Deploy backend not configured on this instance — exported ${fileCount} files instead.`,
            'warning'
          );
          return { files: Object.keys(files), fileCount, deployed: false, reason: data.message };
        }

        if (!resp.ok || !data.ok) {
          throw new Error((data && data.message) || `Deploy failed with status ${resp.status}`);
        }

        this.app.showChatMessage(`Deployed live: ${data.url}`, 'success');
        return { deployed: true, url: data.url, inspectorUrl: data.inspectorUrl, id: data.id };
      } catch (err) {
        this.app.showChatMessage(`Deploy failed: ${err.message}`, 'error');
        return { deployed: false, error: err.message, files: Object.keys(files), fileCount };
      }
    }

    async execCommand(command) {
      this.app.appendTerminal(`$ ${command}`);
      try {
        const resp = await fetch('/api/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command }),
        });
        const data = await resp.json();

        if (!resp.ok) {
          this.app.appendTerminal(`[exec error] ${data.message || resp.status}`);
          return { error: data.message || `exec failed with status ${resp.status}` };
        }

        if (data.stdout) this.app.appendTerminal(data.stdout.replace(/\n+$/, ''));
        if (data.stderr) this.app.appendTerminal(data.stderr.replace(/\n+$/, ''));
        this.app.appendTerminal(`[exit ${data.exitCode}]`);

        return { exitCode: data.exitCode, stdout: data.stdout, stderr: data.stderr };
      } catch (err) {
        this.app.appendTerminal(`[exec error] ${err.message}`);
        return { error: err.message };
      }
    }

    async generateImage(prompt, filename, dir) {
      try {
        const resp = await fetch('/api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });
        const data = await resp.json();

        if (resp.ok && data.ok) {
          const ext = (data.mediaType || 'image/png').split('/')[1] || 'png';
          const base = filename.replace(/\.\w+$/, '');
          const path = `${dir}/${base}.${ext}`;
          this.vfs.write(path, `data:${data.mediaType};base64,${data.base64}`, data.mediaType);
          this.app.showChatMessage(`Generated real image: ${path}`, 'success');
          return { path, ok: true, real: true };
        }

        this.app.showChatMessage(
          `Real image generation unavailable (${data.message || resp.status}) — using a placeholder instead.`,
          'warning'
        );
      } catch (err) {
        this.app.showChatMessage(`Real image generation failed (${err.message}) — using a placeholder instead.`, 'warning');
      }
      return this.simulateImageGeneration(prompt, filename, dir);
    }

    simulateImageGeneration(prompt, filename, dir) {
      const hash = Array.from(prompt).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
      const hue1 = hash % 360;
      const hue2 = (hue1 + 80) % 360;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hue1},80%,55%)"/>
      <stop offset="100%" stop-color="hsl(${hue2},80%,45%)"/>
    </linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#g)"/>
  <text x="50%" y="50%" fill="rgba(255,255,255,0.85)" font-family="monospace" font-size="20"
        text-anchor="middle" dominant-baseline="middle">${this.escapeXml(prompt.slice(0, 60))}</text>
</svg>`;
      const base = filename.replace(/\.\w+$/, '');
      const path = `${dir}/${base}.svg`;
      this.vfs.write(path, svg, 'svg');
      return { path, ok: true };
    }

    escapeXml(str) {
      return str.replace(/[<>&'"]/g, (c) => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
      }[c]));
    }
  }

  window.InscribeWebMCP = InscribeWebMCP;
})();
