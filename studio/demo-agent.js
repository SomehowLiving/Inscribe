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
<title>Set by an agent — Inscribe</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--ink:#17140f;--paper:#ece5d8;--mute:#a2988a;--faint:#6e665a;--rule:#302a21;--red:#c8552b;
--serif:'Instrument Serif',Georgia,serif;--sans:'IBM Plex Sans',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace}
body{background:var(--ink);color:var(--paper);font-family:var(--sans);line-height:1.6;
background-image:repeating-linear-gradient(90deg,rgba(236,229,216,.014) 0 1px,transparent 1px 3px)}
.wrap{max-width:660px;margin:0 auto;padding:0 28px}
header{border-bottom:1px solid var(--rule);padding:64px 0 26px;margin-bottom:38px}
.eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--red);margin-bottom:16px}
h1{font-family:var(--serif);font-weight:400;font-size:clamp(2.7rem,7vw,4.1rem);line-height:1.02;letter-spacing:-.01em}
h1 em{font-style:italic;color:var(--mute)}
.standfirst{font-size:15px;color:var(--mute);margin-top:18px;max-width:46ch}
.rule-note{font-family:var(--mono);font-size:10.5px;color:var(--faint);
border-left:2px solid var(--red);padding-left:11px;margin:0 0 40px}
main{counter-reset:s}
section{border-bottom:1px solid var(--rule);padding:22px 0}
section:last-of-type{border-bottom:none}
h2{font-family:var(--serif);font-size:20px;font-weight:400;margin-bottom:6px}
h2::before{content:counter(s,decimal-leading-zero) '  ';counter-increment:s;
font-family:var(--mono);font-size:11px;color:var(--red);vertical-align:2px}
section p{font-size:13.5px;color:var(--mute);max-width:56ch}
footer{padding:34px 0 60px;font-family:var(--mono);font-size:10.5px;color:var(--faint)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="eyebrow">Composed without a keyboard</div>
    <h1>Set by an <em>agent</em>, not a person.</h1>
    <p class="standfirst">Every character of this page was placed through WebMCP tool
    calls. No hand touched the markup; the tools were the only way in.</p>
  </header>
  <p class="rule-note">inscribe.file.write &rarr; inscribe.preview.refresh &rarr; inscribe.deploy</p>
  <main>
    <section>
      <h2>Capabilities, not coordinates</h2>
      <p>The agent never guessed at a pixel or simulated a click. It read a schema
      and called a named function, the way one program addresses another.</p>
    </section>
    <section>
      <h2>Witnessed as it happened</h2>
      <p>Each call was entered in the ledger with its arguments and result. Nothing
      the agent did was hidden from the person watching.</p>
    </section>
    <section>
      <h2>Held to a confirmation</h2>
      <p>Anything inferred rather than declared waited on a human yes. Withhold it
      and the tool refuses instead of proceeding.</p>
    </section>
  </main>
  <footer>Composed by the Inscribe demonstration agent &mdash; a fixed sequence, no model.</footer>
</div>
</body>
</html>`;
          this.app.vfs.write('/project/index.html', html, 'html');
          this.app.openFile('/project/index.html');
        },
      },
      {
        desc: 'Optimizing styles and animations...',
        action: async () => {
          const css = `/* Set by the agent — supplementary rules */
@media (prefers-reduced-motion: no-preference) {
  main section { animation: settle .5s ease both; }
  main section:nth-of-type(2) { animation-delay: .06s; }
  main section:nth-of-type(3) { animation-delay: .12s; }
}
@keyframes settle { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; } }
::selection { background: rgba(200,85,43,.3); }
a { color: #c8552b; text-underline-offset: 3px; }`;
          this.app.vfs.write('/project/style.css', css, 'css');
        },
      },
      {
        desc: 'Adding interactive JavaScript...',
        action: async () => {
          const js = `// Set by the agent — marks each section as it is read
console.log('%cSet by the Inscribe agent', 'color:#c8552b;font:400 18px Georgia,serif');
const seen = new WeakSet();
const spy = new IntersectionObserver((rows) => {
  for (const row of rows) {
    if (row.isIntersecting && !seen.has(row.target)) {
      seen.add(row.target);
      row.target.style.borderLeft = '2px solid rgba(200,85,43,.5)';
      row.target.style.paddingLeft = '13px';
    }
  }
}, { threshold: 0.6 });
document.querySelectorAll('main section').forEach((s) => spy.observe(s));`;
          this.app.vfs.write('/project/app.js', js, 'javascript');
        },
      },
      {
        desc: 'Generating hero image...',
        action: async () => {
          await this.app.webmcp.callTool('inscribe.image.generate', {
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
          this.app.showChatMessage('Page set. The preview is showing what the agent composed.', 'success');
        },
      },
      {
        desc: 'Deploying to a live URL...',
        action: async () => {
          const result = await this.app.webmcp.deployProject('/project', 'inscribe-demo');
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
