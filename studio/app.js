class InscribeApp {
  constructor() {
    this.vfs = window.vfs;
    this.currentPath = '/welcome.md';
    this.openFiles = new Set(['/welcome.md']);
    this.webmcp = null;
    this.init();
  }

  init() {
    this.bindElements();
    this.bindEvents();
    this.renderFileTree();
    this.loadFile('/welcome.md');
    this.renderTabs();
    this.webmcp = new window.InscribeWebMCP(this.vfs, this);
    this.renderToolList();
    this.refreshPreview('/project');
    this.loadAgentModels();

    this.vfs.onChange(() => this.renderFileTree());

    this.appendTerminal('Inscribe — press ready.');
    this.appendTerminal(`WebMCP bridge active. ${this.webmcp.getToolList().length} tools registered.`);
    this.appendTerminal('Waiting for agent connection...');
  }

  bindElements() {
    this.els = {
      fileTree: document.getElementById('file-tree'),
      editor: document.getElementById('editor'),
      preview: document.getElementById('preview'),
      tabs: document.getElementById('editor-tabs'),
      terminal: document.getElementById('terminal'),
      chatLog: document.getElementById('chat-log'),
      toolList: document.getElementById('tool-list'),
      toolCount: document.getElementById('tool-count'),
      callLog: document.getElementById('call-log'),
      demoOverlay: document.getElementById('demo-overlay'),
      demoBar: document.getElementById('demo-bar'),
      demoStatus: document.getElementById('demo-status'),
      sandboxFrame: document.getElementById('sandbox-frame'),
      agentForm: document.getElementById('agent-form'),
      agentGoal: document.getElementById('agent-goal'),
      agentModel: document.getElementById('agent-model'),
      agentSend: document.getElementById('btn-agent-send'),
      stopAgent: document.getElementById('btn-stop-agent'),
    };
  }

  async loadAgentModels() {
    try {
      const resp = await fetch('/api/agent');
      const data = await resp.json();
      const models = data.models || [];
      this.els.agentModel.innerHTML = '';
      if (models.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = 'No model configured';
        opt.disabled = true;
        this.els.agentModel.appendChild(opt);
        this.els.agentSend.disabled = true;
        return;
      }
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label;
        this.els.agentModel.appendChild(opt);
      }
    } catch (err) {
      this.appendTerminal(`Could not load agent models: ${err.message}`);
    }
  }

  bindEvents() {
    document.getElementById('btn-new-file').onclick = () => {
      const name = prompt('Filename:', '/project/newfile.js');
      if (name) {
        this.vfs.write(name, '// New file\n');
        this.openFile(name);
      }
    };

    document.getElementById('btn-clear-log').onclick = () => {
      this.webmcp.clearLog();
    };

    document.getElementById('btn-clear-term').onclick = () => {
      this.els.terminal.innerHTML = '';
    };

    document.getElementById('btn-demo').onclick = async () => {
      if (this.realAgentBusy || !window.DemoAgent) return;
      this.els.agentSend.disabled = true;
      this.els.agentGoal.disabled = true;
      window.demoAgent = new window.DemoAgent(this);
      await window.demoAgent.start();
      this.els.agentSend.disabled = false;
      this.els.agentGoal.disabled = false;
    };

    document.getElementById('btn-stop-demo').onclick = () => {
      if (window.demoAgent) window.demoAgent.stop();
      this.els.demoOverlay.classList.add('hidden');
    };

    this.els.agentForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const goal = this.els.agentGoal.value.trim();
      const model = this.els.agentModel.value;
      if (!goal || !model || this.realAgentBusy) return;
      this.els.agentGoal.value = '';
      window.realAgent = window.realAgent || new window.RealAgent(this);
      window.realAgent.start(goal, model);
    });

    this.els.stopAgent.onclick = () => {
      if (window.realAgent) window.realAgent.stop();
    };

    this.els.editor.addEventListener('input', () => {
      this.vfs.write(this.currentPath, this.els.editor.value);
    });
  }

  setAgentBusy(busy) {
    this.realAgentBusy = busy;
    this.els.agentSend.disabled = busy;
    this.els.agentGoal.disabled = busy;
    this.els.agentModel.disabled = busy;
    this.els.stopAgent.hidden = !busy;
    document.getElementById('btn-demo').disabled = busy;
  }

  renderFileTree() {
    const tree = this.vfs.getTree();
    this.els.fileTree.innerHTML = '';

    const renderNode = (node) => {
      const div = document.createElement('div');
      div.className = `file-item ${node.type} ${node.path === this.currentPath ? 'active' : ''}`;
      div.style.paddingLeft = (8 + (node.prefix.length / 2) * 16) + 'px';

      const icon = node.type === 'directory' ? '▾' : this.getFileIcon(node.name);
      const iconEl = document.createElement('span');
      iconEl.className = 'file-icon';
      iconEl.textContent = icon;
      const nameEl = document.createElement('span');
      nameEl.textContent = node.name;
      div.appendChild(iconEl);
      div.appendChild(nameEl);

      div.onclick = () => {
        if (node.type === 'file') this.openFile(node.path);
      };

      return div;
    };

    for (const node of tree) {
      this.els.fileTree.appendChild(renderNode(node));
    }
  }

  getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    // Typographic marks, not emoji — a press room has no stickers.
    const marks = {
      js: '\u0192', mjs: '\u0192', jsx: '\u0192', ts: '\u0192', tsx: '\u0192',
      html: '\u2039', css: '\u00b6', json: '{', md: '\u00a7',
      py: '\u0192', svg: '\u25e7', png: '\u25e7', jpg: '\u25e7',
    };
    return marks[ext] || '\u00b7';
  }

  openFile(path) {
    const node = this.vfs.read(path);
    if (node.error) return;

    this.currentPath = path;
    this.openFiles.add(path);
    this.els.editor.value = node.content;
    this.renderTabs();
    this.renderFileTree();

    if (path.endsWith('.html') && this.els.preview.srcdoc) {
      this.els.editor.classList.add('hidden');
      this.els.preview.classList.add('active');
    } else {
      this.els.editor.classList.remove('hidden');
      this.els.preview.classList.remove('active');
    }
  }

  renderTabs() {
    this.els.tabs.innerHTML = '';
    for (const path of this.openFiles) {
      const tab = document.createElement('div');
      tab.className = 'tab' + (path === this.currentPath ? ' active' : '');
      tab.textContent = path.split('/').pop();
      tab.onclick = () => this.openFile(path);
      this.els.tabs.appendChild(tab);
    }
  }

  loadFile(path) {
    const file = this.vfs.read(path);
    if (!file.error) {
      this.els.editor.value = file.content;
    }
  }

  refreshPreview(path = '/project') {
    const files = this.vfs.exportProject(path);
    if (!files || !files['/index.html']) return;

    let html = files['/index.html'];
    if (files['/style.css']) {
      html = html.replace(/<link[^>]*href=["']style\.css["'][^>]*>/i,
        `<style>${files['/style.css']}</style>`);
    }
    if (files['/app.js']) {
      html = html.replace(/<script[^>]*src=["']app\.js["'][^>]*><\/script>/i,
        `<script>${files['/app.js']}<\/script>`);
    }

    this.els.preview.srcdoc = html;
  }

  renderToolList() {
    if (!this.webmcp) return;
    const tools = this.webmcp.getToolList();
    this.els.toolCount.textContent = tools.length;
    this.els.toolList.innerHTML = '';
    for (const t of tools) {
      const item = document.createElement('div');
      item.className = 'tool-item';
      const name = document.createElement('div');
      name.className = 'tool-name';
      name.textContent = t.name;
      const desc = document.createElement('div');
      desc.className = 'tool-desc';
      desc.textContent = t.description;
      item.appendChild(name);
      item.appendChild(desc);
      this.els.toolList.appendChild(item);
    }
  }

  updateLog(logs) {
    this.els.callLog.innerHTML = '';
    for (const l of logs.slice(0, 50)) {
      const entry = document.createElement('div');
      entry.className = `log-entry ${l.type}`;
      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = l.time;
      const msg = document.createElement('span');
      msg.className = 'log-msg';
      msg.textContent = l.message;
      entry.appendChild(time);
      entry.appendChild(msg);
      this.els.callLog.appendChild(entry);
    }
  }

  appendTerminal(text) {
    const line = document.createElement('div');
    line.className = 'terminal-line';
    const span = document.createElement('span');
    span.className = 'terminal-output';
    span.textContent = text;
    line.appendChild(span);
    this.els.terminal.appendChild(line);
    this.els.terminal.scrollTop = this.els.terminal.scrollHeight;
  }

  clearTerminal() {
    this.els.terminal.innerHTML = '';
  }

  showChatMessage(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `chat-entry ${type}`;
    const time = document.createElement('div');
    time.className = 'chat-time';
    time.textContent = new Date().toLocaleTimeString();
    const body = document.createElement('div');
    body.textContent = message;
    entry.appendChild(time);
    entry.appendChild(body);
    this.els.chatLog.appendChild(entry);
    this.els.chatLog.scrollTop = this.els.chatLog.scrollHeight;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new InscribeApp();
});
