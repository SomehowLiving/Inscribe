/**
 * Inscribe — in-browser virtual file system.
 * Backed by localStorage so a project survives a reload; falls back to an
 * in-memory Map if storage is unavailable (private browsing, quota, etc).
 */
(function () {
  const STORAGE_KEY = 'inscribe:vfs:v1';

  const SEED = {
    '/welcome.md': {
      type: 'markdown',
      content:
        '# Inscribe\n\n' +
        'A workshop where the tools are the interface. Every action you can take ' +
        'by hand is also a WebMCP tool under the `inscribe.*` namespace — so an ' +
        'agent operates this editor the same way you do.\n\n' +
        '- **Run scripted demo** (top right) replays a fixed sequence with no model ' +
        'and no tokens spent. It proves the tool layer end to end.\n' +
        '- **Dictation** (bottom right) hands a task to a real model. It reasons over ' +
        'the tool schemas and calls them itself.\n' +
        '- **Instrument** (right) lists every registered tool and enters each call in ' +
        'the ledger as it happens.\n' +
        '- Files under `/project` are what the preview renders and what a deploy ships.\n',
    },
    '/project/index.html': {
      type: 'html',
      content:
        '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
        '<title>My Agent-Built Site</title>\n<link rel="stylesheet" href="style.css">\n' +
        '</head>\n<body>\n<h1>Hello from Inscribe</h1>\n' +
        '<p>Edit me, or ask an agent to.</p>\n<script src="app.js"></script>\n' +
        '</body>\n</html>\n',
    },
    '/project/style.css': {
      type: 'css',
      content: 'body{font-family:system-ui,sans-serif;margin:2rem;color:#111}\n',
    },
    '/project/app.js': {
      type: 'javascript',
      content: "console.log('project app.js loaded');\n",
    },
  };

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      /* storage unavailable or corrupt — fall through to seed */
    }
    return JSON.parse(JSON.stringify(SEED));
  }

  class VirtualFileSystem {
    constructor() {
      this.files = loadFromStorage();
      this.listeners = new Set();
    }

    _persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.files));
      } catch (e) {
        /* quota exceeded or unavailable — in-memory state still works */
      }
      this._notify();
    }

    _notify() {
      for (const cb of this.listeners) {
        try { cb(); } catch (e) { console.error(e); }
      }
    }

    onChange(cb) {
      this.listeners.add(cb);
      return () => this.listeners.delete(cb);
    }

    normalize(path) {
      if (!path.startsWith('/')) path = '/' + path;
      return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    }

    guessType(name) {
      const ext = name.split('.').pop().toLowerCase();
      const map = {
        js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
        html: 'html', css: 'css', json: 'json', md: 'markdown', py: 'python',
        svg: 'svg', txt: 'text',
      };
      return map[ext] || 'text';
    }

    list(dirPath = '/') {
      dirPath = this.normalize(dirPath);
      const prefix = dirPath === '/' ? '/' : dirPath + '/';
      const seen = new Set();
      const out = [];
      for (const path of Object.keys(this.files)) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const [first] = rest.split('/');
        if (!first || seen.has(first)) continue;
        seen.add(first);
        const fullPath = prefix + first;
        const isDir = fullPath !== path;
        out.push({
          name: first,
          path: fullPath,
          type: isDir ? 'directory' : 'file',
        });
      }
      return out.sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1
      );
    }

    getTree(dirPath = '/', depth = 0, prefix = '') {
      const entries = this.list(dirPath);
      let out = [];
      for (const entry of entries) {
        out.push({ ...entry, prefix: prefix + '  ' });
        if (entry.type === 'directory') {
          out = out.concat(this.getTree(entry.path, depth + 1, prefix + '  '));
        }
      }
      return out;
    }

    read(path) {
      path = this.normalize(path);
      const file = this.files[path];
      if (!file) return { error: `No such file: ${path}` };
      return { path, content: file.content, type: file.type };
    }

    write(path, content, type) {
      path = this.normalize(path);
      const existing = this.files[path];
      this.files[path] = {
        type: type || (existing && existing.type) || this.guessType(path),
        content: content ?? '',
      };
      this._persist();
      return { path, ok: true };
    }

    mkdir(path) {
      path = this.normalize(path);
      const marker = path + '/.keep';
      if (!this.files[marker]) {
        this.files[marker] = { type: 'text', content: '' };
        this._persist();
      }
      return { path, ok: true };
    }

    delete(path) {
      path = this.normalize(path);
      let deleted = 0;
      if (this.files[path]) {
        delete this.files[path];
        deleted++;
      }
      const prefix = path + '/';
      for (const p of Object.keys(this.files)) {
        if (p.startsWith(prefix)) {
          delete this.files[p];
          deleted++;
        }
      }
      if (deleted === 0) return { error: `No such file or directory: ${path}` };
      this._persist();
      return { path, ok: true, deleted };
    }

    exportProject(dirPath = '/project') {
      dirPath = this.normalize(dirPath);
      const prefix = dirPath + '/';
      const out = {};
      for (const [path, file] of Object.entries(this.files)) {
        if (!path.startsWith(prefix)) continue;
        if (path.endsWith('/.keep')) continue;
        out['/' + path.slice(prefix.length)] = file.content;
      }
      return out;
    }
  }

  window.vfs = new VirtualFileSystem();
})();
