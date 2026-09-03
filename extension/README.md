# Inscribe Universal (extension)

Turns **any** website into an agent-operable surface. Where a site declares its own
WebMCP tools, we use those. Where it doesn't — which is almost everywhere — we
synthesize tools from its markup, and require your confirmation before touching
anything we inferred.

## Load it

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this `extension/` folder
3. Visit any site; click the ◆ badge (or `Ctrl+Shift+F`)

Optional: enable `chrome://flags/#enable-webmcp-testing` to let native WebMCP sites
expose their real tools — the overlay header shows `native WebMCP` vs `polyfilled`.

## Architecture

Three layers, because the page world and the extension can't touch each other:

| Layer | World | Job |
|---|---|---|
| `src/page/bootstrap.js` | MAIN, `document_start` | Preserve native `document.modelContext`, else install a spec-shaped local one |
| `src/page/synthesize.js` | MAIN | DOM → tool candidates (the part the ecosystem hasn't shipped) |
| `src/page/registrar.js` | MAIN | Register tools; execute them against the live DOM via captured selectors |
| `src/isolated/relay.js` | ISOLATED | `window.postMessage` ↔ `chrome.runtime` port |
| `src/isolated/overlay.js` | ISOLATED | Inspector panel + confirmation gate (closed shadow root) |
| `src/background.js` | SW | Per-tab registry; agent loop via Inscribe's `/api/agent` |

## Trust model

Borrowed from the spec's `toolautosubmit` semantics:

- **declared** — the site author wrote `toolname`. Trusted; may act directly.
- **inferred** — we derived it from markup. **Always asks you first**, and fails
  closed if you don't answer.
- Forms are filled but **not submitted** unless the author opted in; we focus the
  submit control and hand the decision back to you.
- Password/CVV/SSN-shaped fields are never exposed. If removing one leaves a form
  unable to succeed, the tool is withheld entirely rather than offered broken.

## Measured behaviour

Run against real sites (`accessible-name` chain + spec-style form→JSON-Schema
reduction, no model call needed):

| Site | Result |
|---|---|
| `httpbin.org/forms/post` | 1 form @ 90% — all 7 params typed correctly (`email`, `enum`, `boolean`, `time`) |
| `en.wikipedia.org` | 1 form @ 70% — `form_search`; 195 low-signal links rejected |
| `duckduckgo.com` | search form @ 80% + 25 named actions (capped from 34) |
| `news.ycombinator.com/login` | 0 tools — both credential forms deliberately withheld |
| `example.com` | 0 tools — nothing worth exposing |

## Known limits

- Bare links score 0.35 and are dropped below the 0.5 threshold, so link-heavy
  pages yield forms only. That's deliberate, but it does mean genuinely useful
  navigation links get missed.
- Actions are capped at 25 per page by confidence.
- Same-page-only: cross-origin iframes aren't scanned (`all_frames: false`).
- No accessibility-tree input yet — names come from the ARIA precedence chain
  computed over the DOM, which is close but not identical.
