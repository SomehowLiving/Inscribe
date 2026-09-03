# Inscribe

An agent-native web IDE built on [WebMCP](https://github.com/webmachinelearning/webmcp). The
file system, code execution, terminal, image generation and deployment aren't just UI features —
they're a `inscribe.*` tool catalog registered via `document.modelContext`. A human can click
around it, but an AI agent can *operate* it directly, and the human watches every tool call
land in real time.

**Live:** https://studio-bay-omega.vercel.app

## Why

Most sites are passive — they wait for clicks. Agents visiting them screenshot, guess at
pixel positions, and simulate clicks; one CSS change breaks the flow. WebMCP inverts that:
the site *declares its capabilities* and the agent calls them by name with structured
arguments.

Inscribe is that inversion applied to an IDE. The tool layer is primary; the UI is
a projection of it. Nothing happens in the interface that isn't also a tool call an agent
could have made instead — which is what makes the human a genuine spectator and supervisor
rather than a bystander.

## The 12 tools

| Tool | What it does |
|---|---|
| `inscribe.file.list` / `read` / `write` / `delete` / `mkdir` | CRUD on an in-browser virtual file system (localStorage-backed) |
| `inscribe.code.execute` | Runs JS in a sandboxed iframe, captures console output |
| `inscribe.preview.refresh` | Re-renders the live preview, inlining CSS/JS |
| `inscribe.terminal.exec` | Runs a **real shell command** in an ephemeral [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) microVM — isolated from the server's own environment and secrets |
| `inscribe.chat.send` | Posts into the human-visible Agent Chat panel |
| `inscribe.system.info` | IDE metadata and tool count |
| `inscribe.image.generate` | Real image generation via an OpenRouter image model; falls back to a placeholder SVG if unavailable |
| `inscribe.deploy` | Creates a **real deployment** of what the agent built, via the Vercel REST API |

## Architecture

```
Agent (LLM)  ──►  /api/agent  ──►  provider (Groq / OpenRouter / Google / NVIDIA)
                      │
                      ▼  returns tool calls, does NOT execute them
              real-agent.js (browser)
                      │
                      ▼  executes for real
              webmcp.js  ──►  document.modelContext.registerTool()
                      │
                      ▼
              VFS · sandbox · preview · terminal · deploy
                      │
                      ▼
              UI panels + WebMCP Inspector (live call log)
```

The model call happens server-side (keys never reach the browser). Tool **execution** happens
client-side against the real VFS and UI — so the server never touches application state, it
only decides what to call next. Tools are registered with the AI SDK *without* an `execute`
function, which is what makes the SDK hand back tool-call requests instead of running them.

### Two drivers, same tools

- **Demo Agent** (`demo-agent.js`) — a fixed script. Free, deterministic, no API key. Proves
  the tool layer works.
- **Real Agent** (`real-agent.js`) — a genuine LLM loop. You type a goal; the model reasons
  over the live tool schemas and decides what to call. Retries transient failures (network,
  5xx) up to 3 times with backoff; caps at 15 steps.

### Model options

Eight models across four providers, each verified against its provider's live catalog for
tool-calling support. The dropdown only lists providers whose key is actually configured.

## Run it

```bash
cd studio
cp .env.example .env      # optional — fill in whichever providers you have
npm install
python3 -m http.server 3000   # static only: UI + demo agent work, /api/* won't
```

For the full experience (real agent, sandboxed exec, deploy) the `/api/*` functions need a
Vercel runtime:

```bash
npx vercel dev
```

## WebMCP notes

Written against the current spec, which is worth stating precisely because a lot of
secondary material online is stale:

- The API is **`document.modelContext`**, not `navigator.modelContext` (moved to `Document`
  in [PR #184](https://github.com/webmachinelearning/webmcp/pull/184), May 2026). We prefer
  `document` and only fall back to `navigator` for older polyfills.
- The surface is exactly three methods plus one event: `registerTool()`, `getTools()`,
  `executeTool()`, `toolchange`. Names like `provideContext()` or `unregisterTool()` are
  stale draft vocabulary and don't exist.
- `registerTool()` returns a Promise that rejects with `NotAllowedError` when the `tools`
  permissions policy denies it — handled here rather than left as an unhandled rejection.
- Unregistration is via `AbortSignal`, not a method.
- Status: Chrome 149 and Edge 150 **origin trials** (enable locally with
  `chrome://flags/#enable-webmcp-testing`). Not shipped in any browser; WebKit has filed an
  `oppose` position and Mozilla `neutral`. This is incubation-stage tech.

## Known limitations

- `inscribe.deploy` uses a project-scoped token, so agent-built sites land as new deployments
  within one Vercel project rather than separate projects.
- Real image generation needs OpenRouter credits; without them it silently falls back to a
  placeholder SVG.
- The `/api/*` endpoints are unauthenticated. Fine for a demo; they'd need auth or rate
  limiting before any real exposure.
- `inscribe.terminal.exec` is bounded (~20s, 8KB output) and its long-command cutoff comes from
  the sandbox lifetime rather than the per-command timeout.

## License

MIT
