class DemoAgent {
  constructor(app) {
    this.app = app;
    this.running = false;
    this.step = 0;
    this.steps = [
      {
        desc: 'Analyzing project structure...',
        action: async () => {
          const result = this.app.vfs.list('/project');
          this.app.webmcp.log('Agent discovered ' + result.length + ' files in project', 'info');
        },
      },
      {
        desc: 'Creating hero section component...',
        action: async () => {
          const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Neon Portfolio — Built by Agent</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#050508;color:#fff;overflow-x:hidden}
.hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem;position:relative}
.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(0,212,255,0.1),transparent 70%);pointer-events:none}
h1{font-size:clamp(3rem,8vw,6rem);font-weight:800;background:linear-gradient(135deg,#00d4ff,#a855f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:1rem}
.subtitle{font-size:1.3rem;color:#888;max-width:600px;line-height:1.6}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:2rem;padding:4rem 2rem;max-width:1200px;margin:0 auto}
.card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:2rem;transition:all 0.3s}
.card:hover{transform:translateY(-5px);border-color:rgba(0,212,255,0.3);box-shadow:0 10px 40px rgba(0,212,255,0.1)}
.card h3{color:#00d4ff;margin-bottom:0.5rem;font-size:1.3rem}
.card p{color:#888;line-height:1.6}
footer{text-align:center;padding:3rem;color:#444;font-size:0.9rem}
.glow{position:fixed;width:300px;height:300px;border-radius:50%;filter:blur(80px);opacity:0.3;pointer-events:none}
.glow-1{background:#00d4ff;top:10%;left:10%}
.glow-2{background:#a855f7;bottom:10%;right:10%}
</style>
</head>
<body>
<div class="glow glow-1"></div>
<div class="glow glow-2"></div>
<section class="hero">
  <h1>AgentBuilt</h1>
  <p class="subtitle">This entire website was constructed by an AI agent using nothing but WebMCP tool calls. No human wrote a single line of this code.</p>
</section>
<section class="grid">
  <div class="card">
    <h3>🔮 WebMCP Native</h3>
    <p>Every tool in AgentForge is exposed via the W3C WebMCP standard, allowing any AI agent to browse, edit, and deploy autonomously.</p>
  </div>
  <div class="card">
    <h3>⚡ Real-time Execution</h3>
    <p>The agent executes code in a sandboxed iframe, sees live previews, and iterates based on visual feedback — just like a human developer.</p>
  </div>
  <div class="card">
    <h3>🌐 Instant Deploy</h3>
    <p>With a single tool call, the agent can deploy the finished project to the web, making it accessible to humans everywhere.</p>
  </div>
</section>
<footer>
  <p>Built autonomously by AgentForge Demo Agent via WebMCP</p>
</footer>
<script>
document.querySelectorAll('.card').forEach(card => {
  card.addEventListener('mouseenter', () => {
    card.style.borderColor = '#00d4ff';
  });
  card.addEventListener('mouseleave', () => {
    card.style.borderColor = 'rgba(255,255,255,0.08)';
  });
});
<\/script>
</body>
</html>`;
          this.app.vfs.write('/project/index.html', html, 'html');
          this.app.openFile('/project/index.html');
        },
      },
      {
        desc: 'Optimizing styles and animations...',
        action: async () => {
          const css = `/* Agent-generated styles */
@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-20px); }
}
.hero h1 { animation: float 6s ease-in-out infinite; }
::selection { background: rgba(0,212,255,0.3); color: #fff; }`;
          this.app.vfs.write('/project/style.css', css, 'css');
        },
      },
      {
        desc: 'Adding interactive JavaScript...',
        action: async () => {
          const js = `// Agent-generated interactions
console.log('%c🔥 Built by AgentForge Agent', 'color:#00d4ff;font-size:20px;font-weight:bold;');
document.addEventListener('mousemove', (e) => {
  const glows = document.querySelectorAll('.glow');
  const x = e.clientX / window.innerWidth;
  const y = e.clientY / window.innerHeight;
  glows[0].style.transform = \`translate(\${x * 50}px, \${y * 50}px)\`;
  glows[1].style.transform = \`translate(\${-x * 50}px, \${-y * 50}px)\`;
});`;
          this.app.vfs.write('/project/app.js', js, 'javascript');
        },
      },
      {
        desc: 'Generating hero image...',
        action: async () => {
          await this.app.webmcp.callTool('forge.image.generate', {
            prompt: 'Abstract neon cyberpunk landscape with flowing data streams and holographic interfaces',
            filename: 'hero-bg',
            dir: '/project',
          });
        },
      },
      {
        desc: 'Refreshing live preview...',
        action: async () => {
          this.app.refreshPreview('/project');
          this.app.els.editor.classList.add('hidden');
          this.app.els.preview.classList.add('active');
        },
      },
      {
        desc: 'Running final validation...',
        action: async () => {
          const files = this.app.vfs.list('/project');
          this.app.webmcp.log(`Validation complete. ${files.length} files in project.`, 'success');
          this.app.showChatMessage('Website built successfully! Switch to the Preview tab to see the result.', 'success');
        },
      },
      {
        desc: 'Deploying to a live URL...',
        action: async () => {
          const result = await this.app.webmcp.deployProject('/project', 'agentforge-demo');
          if (result.deployed) {
            this.app.webmcp.log(`Deployed: ${result.url}`, 'success');
          } else {
            this.app.webmcp.log(`Deploy skipped: ${result.reason || result.error || 'unknown reason'}`, 'warning');
          }
        },
      },
    ];
  }

  async start() {
    this.running = true;
    this.step = 0;
    document.getElementById('demo-overlay').classList.remove('hidden');

    for (const s of this.steps) {
      if (!this.running) break;
      this.updateStatus(s.desc, this.step / this.steps.length);
      await this.delay(800);
      try { await s.action(); } catch (e) { console.error(e); }
      this.step++;
      await this.delay(600);
    }

    if (this.running) {
      this.updateStatus('Complete! Check the Preview tab.', 1);
      await this.delay(2000);
      document.getElementById('demo-overlay').classList.add('hidden');
    }
    this.running = false;
  }

  stop() {
    this.running = false;
  }

  updateStatus(text, progress) {
    document.getElementById('demo-status').textContent = text;
    document.getElementById('demo-bar').style.width = (progress * 100) + '%';
  }

  delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

window.DemoAgent = DemoAgent;
