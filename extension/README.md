# Inscribe Universal (extension)

Reads a site's WebMCP tools where they exist, and infers candidate tools from the DOM where they
don't — keeping the two strictly apart. It does **not** add native WebMCP to other people's
websites; it brings its own agent and labels its own guesses as guesses.

## Load it

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this `extension/` folder
3. Visit any site; click the `I` badge (or `Ctrl+Shift+F`)

Optional: enable `chrome://flags/#enable-webmcp-testing` so a WebMCP-enabled site's *native*
declarations become visible. The panel header shows `native WebMCP` or `polyfilled`.

## Two contexts, on purpose

| Context | Holds | Written by | Trust |
|---|---|---|---|
| `document.modelContext` | the site's own declared tools | **the site only** | trusted, runs directly |
| `window.__inscribe.own` | DOM-inferred + Inscribe capabilities | Inscribe | inferred needs confirmation |

`registerTool` on the page's context is the author's channel. Writing our inferences there would
make them look authored to any other agent present, so we only ever read it. The polyfill we
install when native support is absent exists so *the site* can still declare tools — not so we can.

Provenance shown in the panel is derived from which context answered `getTools()`.

## Layers

| File | World | Job |
|---|---|---|
| `src/page/bootstrap.js` | MAIN, `document_start` | Preserve/polyfill `document.modelContext`; create Inscribe's own context |
| `src/page/synthesize.js` | MAIN | DOM → JSON Schema candidates with unique-verified selectors |
| `src/page/tinker.js` | MAIN | Themes, restyle, hide, text, image swap; per-origin persistence |
| `src/page/annotate.js` | MAIN | Element-anchored highlights, notes, arrows, freehand |
| `src/page/registrar.js` | MAIN | Registers into `own`; answers `discover`; dispatches via `executeTool()` |
| `src/isolated/relay.js` | ISOLATED | `window.postMessage` ↔ `chrome.runtime` port |
| `src/isolated/overlay.js` | ISOLATED | Panel, provenance view, confirmation gate, toolbar |
| `src/background.js` | SW | Runs discovery, drives the agent loop via `/api/agent` |

Execution has no direct-call fallback: if WebMCP is unavailable, the dispatcher errors. `npm run
eval` asserts this.

## Trust tiers

- **Cosmetic** (`inscribe.ui.*`, `inscribe.draw.*`) — immediate, undoable, no prompt.
- **Inferred page actions** (`form_*`, `click_*`) — always ask first, and fail closed after 60s if
  unanswered. Forms are filled but not submitted unless the author set `toolautosubmit`.
- Password/CVV/SSN-shaped fields are never exposed. A form that can't succeed without one is
  withheld rather than offered broken.

## Synthesis, measured

Deterministic — no model call. Accessible names follow the ARIA precedence chain
(`aria-labelledby` → `aria-label` → `<label>` → `title` → `placeholder`); schemas follow the spec's
form → JSON Schema reduction. Every selector is verified to match exactly one element.

| Site | Result |
|---|---|
| `httpbin.org/forms/post` | 1 form @ 90% — all 7 params typed (`email`, radio enum, boolean, time) |
| `en.wikipedia.org` | 1 form — `form_search`; 195 low-signal links rejected |
| `news.ycombinator.com/login` | **0 tools** — credential forms withheld |

## Limits

- Bare links score below the 0.5 confidence floor and are dropped; actions capped at 25 per page.
- Cross-origin iframes unscanned (`all_frames: false`).
- A page can forge a `confirm-response` via `postMessage` — it gains nothing, since the tools only
  touch that page's own DOM which it could already modify, but it is a real property of the design.
