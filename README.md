# Inscribe

**Native WebMCP when the site speaks it. Inferred capabilities when it doesn't.**

Inscribe is two things built on [WebMCP](https://github.com/webmachinelearning/webmcp): a browser
extension that lets an agent operate and tinker with any website, and a hosted workshop
(`studio/`) that is itself a WebMCP site.

**Live studio:** https://studio-bay-omega.vercel.app
**Extension:** load `extension/` unpacked — see [extension/README.md](extension/README.md)

## Why browser agents struggle with websites

An agent handed a web page has to work backwards from pixels: screenshot it, guess which box is
the search field, simulate a click, screenshot again to see whether anything happened. One CSS
change breaks the chain. Chrome's own framing is that this "leaves each step open to
interpretation by the agent."

WebMCP inverts it. The site *declares* its capabilities as named tools with JSON Schema inputs, and
the agent calls them — acting on meaning instead of coordinates.

## The problem Inscribe addresses

WebMCP is real but young: Chrome 149 and Edge 150 origin trials, no browser has shipped it, WebKit
has filed an `oppose` position. So today **almost no site declares anything**. An agent that can
only use native WebMCP can operate approximately nothing.

Inscribe handles both cases, and keeps them strictly separate.

### Path 1 — a site that speaks WebMCP

```
Website declares its own tools
        ↓  document.modelContext.registerTool()
Inscribe discovers them          getTools()
        ↓
Agent invokes one                executeTool()
        ↓
The site's own logic runs
        ↓
Visible state change + structured result
```

These tools are trusted: the author wrote them, they mean what they say, and Inscribe runs them
without interposing itself.

### Path 2 — a site that declares nothing

```
Website's DOM
        ↓  deterministic synthesis (no model call)
Candidate tools + unique selectors
        ↓  registered in Inscribe's OWN context, marked untrusted
Agent invokes one                executeTool()
        ↓
Human confirmation gate
        ↓
Page changes, or the tool refuses
```

### Why the two paths are separate

`document.modelContext` means *"what this document declares."* If Inscribe registered its guesses
there, any other agent on the page — Chrome's built-in one, ChatGPT Desktop — would read them as
the site's own words. So Inscribe never writes to the page's context. Its tools live in
`window.__inscribe.own`, a second ModelContext with the same three-method surface.

Provenance in the UI is derived from **which context answered `getTools()`**, not from a flag
anyone maintains by hand:

| Label | Source | Trust |
|---|---|---|
| declared by site | `document.modelContext` | trusted; runs directly |
| inferred by Inscribe | `inscribe.own`, `untrustedContentHint: true` | needs human confirmation |
| Inscribe capability | `inscribe.own` | extension powers over the page |

Inscribe does **not** "add WebMCP to every website." It reads WebMCP where it exists and infers
candidates where it doesn't, labelled as inferences.

## What you can do

**On any site** (extension): describe a change and watch it happen — theme it, restyle parts, hide
things, rewrite text, swap images, or annotate it with highlights, notes and arrows. Edits persist
per origin and are undoable. Where the site has real forms, the agent can fill them.

**In the studio**: ten `inscribe.*` tools over a browser file system, a sandboxed JS runner, a real
shell in an ephemeral Linux VM, image generation, and deployment to a live URL.

## Safety model

Two tiers, because a restyle and a deployment are not comparable:

- **Cosmetic** (`inscribe.ui.*`, `inscribe.draw.*`) — applies immediately, undoable, no prompt.
  Confirming every "make it darker" would make the product unusable.
- **Consequential** — requires a human click the agent has no way to make, and fails closed if
  unanswered. Covers inferred page actions, plus `file.delete`, `terminal.exec`,
  `image.generate` (spends money) and `deploy` in the studio.

Page-derived text is treated as data, never instruction: names and descriptions are stripped of
control characters and truncated to Chrome's budgets (30 / 500 / 150 chars), and the page title and
URL reach the model inside an explicit untrusted block. Password, CVV and SSN-shaped fields are
never exposed; a form left unable to succeed without one is withheld rather than offered broken.

## Evals

```bash
npm install
npm run eval
```

37 deterministic assertions against a local fixture — no model, no network. The fixture is a page
that declares one tool natively *and* has plain forms, so both paths are covered at once. Four
assertions exist to prove WebMCP is load-bearing: remove `getTools()` or `executeTool()` and
discovery fails, execution fails, the DOM is untouched, and the dispatcher errors rather than
falling back to a direct call.

## Repository

| Path | |
|---|---|
| `extension/` | MV3 extension — bootstrap, synthesizer, tinker, annotate, registrar, overlay, worker |
| `studio/` | The hosted WebMCP site and its agent loop |
| `tests/` | Eval suite + fixture |
| `repos/` | Reference clones (spec, Dark Reader, VisBug, AgentBoard…), gitignored |

## Known limitations

- Native WebMCP needs `chrome://flags/#enable-webmcp-testing` or a site-served trial token. An
  extension cannot enable it for a third-party origin, so Inscribe brings its own agent.
- Inferred tools are guesses. Bare links are dropped below a confidence floor, so link-heavy pages
  yield forms only, and actions are capped at 25 per page.
- Cross-origin iframes are not scanned (`all_frames: false`).
- `smartdark` costs ~90ms and ~100KB of generated CSS on a large article and can miss colours
  applied after the scan, which is why filter-based `dark` remains the default.
- Studio's `/api/*` endpoints are unauthenticated — fine for a demo, not for exposure.
- The studio's `deploy` token is scoped to one Vercel project, so agent-built pages land as
  deployments within it rather than separate projects.

## License

MIT
