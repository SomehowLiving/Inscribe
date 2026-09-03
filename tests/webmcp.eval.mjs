/**
 * Inscribe — WebMCP eval suite.
 *
 * Deterministic by construction: it drives the WebMCP surface directly against
 * a local fixture, with no model in the loop and no network. Chrome's eval
 * guidance asks for isolation tests and deterministic tests before
 * probabilistic ones (developer.chrome.com/docs/ai/webmcp/evals); this is
 * those two tiers. Model-in-the-loop selection is a separate, probabilistic
 * concern and is deliberately not asserted here.
 *
 * The load-bearing test is REMOVAL: if WebMCP discovery/execution is taken
 * away, the workflow must fail. That is the property the audit found missing.
 *
 * Usage: node tests/webmcp.eval.mjs
 */
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const EXT = resolve(import.meta.dirname, '..', 'extension');
const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures');
const PORT = 8791;
const URL = `http://localhost:${PORT}/page.html`;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: FIXTURE_DIR,
  stdio: 'ignore',
});
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(URL);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('fixture server did not start');
}

await waitForServer();

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'inscribe-eval-')), {
  channel: 'chromium',
  args: [
    '--headless=new', '--no-sandbox',
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
  ],
});

const page = await ctx.newPage({ viewport: { width: 1200, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

// Auto-approve stands in for the human clicking "Allow once". Individual tests
// override this where refusal is the behaviour under test.
async function armApproval(approve) {
  await page.evaluate((ok) => {
    window.__evalApprove = ok;
    if (!window.__evalArmed) {
      window.__evalArmed = true;
      window.addEventListener('message', (e) => {
        if (e.data?.source === 'inscribe-page' && e.data.type === 'confirm-request') {
          if (window.__evalApprove === null) return; // no answer: exercise fail-closed
          window.postMessage({
            source: 'inscribe-ext',
            type: 'confirm-response',
            payload: { id: e.data.payload.id, approved: window.__evalApprove },
          }, location.origin);
        }
      });
    }
  }, approve);
}

// ---------------------------------------------------------------- 1. DISCOVERY
section('1. Tool discovery goes through WebMCP getTools()');

const discovery = await page.evaluate(async () => {
  const i = window.__inscribe;
  const site = await i.page.getTools();
  const own = await i.own.getTools();
  return {
    hasTwoContexts: Boolean(i.page && i.own && i.page !== i.own),
    site: site.map((t) => ({ name: t.name, ann: t.annotations })),
    own: own.map((t) => ({
      name: t.name, title: t.title, description: t.description,
      ann: t.annotations, schema: t.inputSchema,
    })),
  };
});

check('two distinct ModelContexts exist (site vs Inscribe)', discovery.hasTwoContexts);
check('Inscribe context reports tools', discovery.own.length > 0, `got ${discovery.own.length}`);
check(
  'site context is NOT polluted with Inscribe tools',
  discovery.site.every((t) => !t.name.startsWith('inscribe.')),
  `site tools: ${discovery.site.map((t) => t.name).join(',') || '(none)'}`
);
check(
  'every tool carries a title (spec RegisteredTool.title)',
  discovery.own.every((t) => typeof t.title === 'string' && t.title.length > 0)
);

const inferredForm = discovery.own.find((t) => t.name.startsWith('form_'));
check('the plain form was inferred into a tool', Boolean(inferredForm),
  discovery.own.map((t) => t.name).join(','));

check('the site\u2019s own declared tool was discovered', 
  discovery.site.some((t) => t.name === 'place_order'),
  `site tools: ${discovery.site.map((t) => t.name).join(',') || '(none)'}`);

// --------------------------------------------------------- 1b. PROVENANCE
section('1b. Provenance is derived from the answering context');

const prov = await page.evaluate(async () => {
  const out = await new Promise((resolve) => {
    const onMsg = (e) => {
      if (e.data?.source === 'inscribe-page' && e.data.type === 'discovery') {
        window.removeEventListener('message', onMsg);
        resolve(e.data.payload);
      }
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ source: 'inscribe-ext', type: 'discover', payload: {} }, location.origin);
    setTimeout(() => resolve(null), 5000);
  });
  return out && {
    counts: out.counts,
    siteProv: [...new Set((out.site || []).map((t) => t.provenance))],
    ownProv: [...new Set((out.inscribe || []).map((t) => t.provenance))],
    contexts: [...new Set([...(out.site || []), ...(out.inscribe || [])].map((t) => t.context))],
  };
});

check('discovery trace is emitted', Boolean(prov));
check('site tools are labelled site-declared',
  prov?.siteProv.length === 1 && prov.siteProv[0] === 'site-declared', JSON.stringify(prov?.siteProv));
check('Inscribe tools are labelled inferred or extension',
  (prov?.ownProv || []).every((p) => p === 'inferred-from-dom' || p === 'inscribe-extension'),
  JSON.stringify(prov?.ownProv));
check('the two contexts are reported distinctly',
  (prov?.contexts || []).includes('document.modelContext') && (prov?.contexts || []).includes('inscribe.own'),
  JSON.stringify(prov?.contexts));

// ------------------------------------------- 1c. NATIVE TOOL EXECUTION
section('1c. Native declared tool executes through the site\u2019s own context');

const nativeExec = await page.evaluate(async () => {
  const i = window.__inscribe;
  const tools = await i.page.getTools();
  const handle = tools.find((t) => t.name === 'place_order');
  if (!handle) return { missing: true };
  const raw = await i.page.executeTool(handle, { product: 'Hammer', qty: 3 });
  return {
    raw: String(raw).slice(0, 90),
    status: document.getElementById('status')?.textContent,
    field: document.getElementById('pname')?.value,
  };
});
check('native tool ran via document.modelContext.executeTool', !nativeExec.missing);
check('the site\u2019s own logic produced a visible state change',
  nativeExec.status === 'Order placed: 3 x Hammer', nativeExec.status);
check('and it filled its own field', nativeExec.field === 'Hammer', nativeExec.field);
check('native tool needed NO Inscribe confirmation (site is trusted)',
  /Ordered 3 x Hammer/.test(nativeExec.raw), nativeExec.raw);

// ------------------------------------- 1d. DECLARED BEATS INFERRED
section('1d. A site declaration suppresses the competing inference');

const collision = await page.evaluate(async () => {
  const i = window.__inscribe;
  const site = (await i.page.getTools()).map((t) => t.name);
  const own = (await i.own.getTools()).map((t) => t.name);
  return { site, own, overlap: own.filter((n) => site.includes(n)) };
});
check('no inferred tool duplicates a site-declared name',
  collision.overlap.length === 0, `overlap: ${collision.overlap.join(',')}`);
check('the declared name is still available from the site context',
  collision.site.includes('place_order'), collision.site.join(','));

// ------------------------------------------------------- 2. CHROME BUDGETS
section('2. Chrome character budgets (30 name / 500 desc / 150 param)');

const overName = discovery.own.filter((t) => t.name.length > 30).map((t) => t.name);
check('all tool names <= 30 chars', overName.length === 0, overName.join(','));

const overDesc = discovery.own.filter((t) => (t.description || '').length > 500).map((t) => t.name);
check('all descriptions <= 500 chars', overDesc.length === 0, overDesc.join(','));

const overParam = [];
for (const t of discovery.own) {
  for (const [k, v] of Object.entries(t.schema?.properties || {})) {
    if ((v.description || '').length > 150) overParam.push(`${t.name}.${k}`);
  }
}
check('all parameter descriptions <= 150 chars', overParam.length === 0, overParam.join(','));

// ------------------------------------------------- 3. UNTRUSTED CONTENT
section('3. Page-derived content is data, not instructions');

const evil = discovery.own.find((t) => /deals|ignore/i.test(t.name + t.description));
check('the injection-laden control did not become a trusted tool',
  !evil || evil.ann?.untrustedContentHint === true,
  evil ? `${evil.name} untrustedContentHint=${evil.ann?.untrustedContentHint}` : 'not registered at all');

const anyNewline = discovery.own.some((t) => /[\r\n`]/.test(`${t.name}${t.description}`));
check('no tool name/description carries newlines or backticks', !anyNewline);

check('inferred page tools are all marked untrustedContentHint',
  discovery.own.filter((t) => t.name.startsWith('form_') || t.name.startsWith('click_'))
    .every((t) => t.ann?.untrustedContentHint === true));

check('extension tools are NOT marked untrusted (they are ours)',
  discovery.own.filter((t) => t.name.startsWith('inscribe.'))
    .every((t) => t.ann?.untrustedContentHint === false));

// ------------------------------------------- 4. CREDENTIAL FORM WITHHELD
section('4. Credential forms are withheld, not offered crippled');

const loginTool = discovery.own.find((t) => /login|sign_in|user/i.test(t.name));
check('no tool was registered for the password form', !loginTool,
  loginTool ? loginTool.name : '');

// --------------------------------------------- 5. EXECUTION via executeTool
section('5. Execution goes through executeTool() and changes the real DOM');

await armApproval(true);
const exec = await page.evaluate(async (toolName) => {
  const i = window.__inscribe;
  const tools = await i.own.getTools();
  const handle = tools.find((t) => t.name === toolName);
  const raw = await i.own.executeTool(handle, { q: 'hammer', dept: 'tools' });
  return {
    rawIsString: typeof raw === 'string',
    domValue: document.querySelector('#plain [name=q]')?.value,
    deptValue: document.querySelector('#plain [name=dept]')?.value,
    url: location.pathname,
  };
}, inferredForm?.name);

check('executeTool resolves to a DOMString (per spec)', exec.rawIsString, typeof exec.rawIsString);
check('the real DOM was updated by the tool', exec.domValue === 'hammer', `got "${exec.domValue}"`);
check('select was set too', exec.deptValue === 'tools', `got "${exec.deptValue}"`);
check('form was NOT auto-submitted (no toolautosubmit)', exec.url.endsWith('page.html'));

// ------------------------------------------------- 6. CONFIRMATION BOUNDARY
section('6. Consequential/inferred actions require human approval');

await page.evaluate(() => { document.querySelector('#plain [name=q]').value = ''; });
await armApproval(false);
const declined = await page.evaluate(async (toolName) => {
  const i = window.__inscribe;
  const tools = await i.own.getTools();
  const handle = tools.find((t) => t.name === toolName);
  const raw = await i.own.executeTool(handle, { q: 'SHOULD NOT APPEAR' });
  return { raw: String(raw), domValue: document.querySelector('#plain [name=q]')?.value };
}, inferredForm?.name);

check('declining yields an error result', /refus|did not confirm/i.test(declined.raw), declined.raw.slice(0, 80));
check('declining leaves the DOM untouched', declined.domValue === '', `got "${declined.domValue}"`);

// ------------------------------------------------------ 7. ERROR HANDLING
section('7. Error handling is descriptive, not silent');

const errCase = await page.evaluate(async () => {
  const i = window.__inscribe;
  try {
    await i.own.executeTool({ name: 'no_such_tool_at_all' }, {});
    return { threw: false };
  } catch (err) {
    return { threw: true, name: err.name, message: err.message };
  }
});
check('unknown tool rejects rather than silently succeeding', errCase.threw);
check('rejection names the missing tool', /no_such_tool_at_all/.test(errCase.message || ''), errCase.message);

// ----------------------------------- 8. REMOVAL PROOF: WebMCP is load-bearing
section('8. REMOVAL PROOF — without WebMCP the workflow cannot run');

await armApproval(true);
const removal = await page.evaluate(async (toolName) => {
  const i = window.__inscribe;
  document.querySelector('#plain [name=q]').value = '';

  // Take away the WebMCP surface the agent path depends on.
  const savedGet = i.own.getTools;
  const savedExec = i.own.executeTool;
  i.own.getTools = () => Promise.reject(new DOMException('gone', 'NotAllowedError'));
  i.own.executeTool = () => Promise.reject(new DOMException('gone', 'NotAllowedError'));

  let discoveryFailed = false;
  let executionFailed = false;
  try { await i.own.getTools(); } catch { discoveryFailed = true; }
  try { await i.own.executeTool({ name: toolName }, { q: 'hammer' }); } catch { executionFailed = true; }

  const domAfter = document.querySelector('#plain [name=q]')?.value;

  i.own.getTools = savedGet;
  i.own.executeTool = savedExec;
  return { discoveryFailed, executionFailed, domAfter };
}, inferredForm?.name);

check('discovery fails when getTools() is removed', removal.discoveryFailed);
check('execution fails when executeTool() is removed', removal.executionFailed);
check('and nothing happened to the page as a side effect', removal.domAfter === '', `got "${removal.domAfter}"`);

// The registrar's own dispatcher must refuse when WebMCP is unavailable,
// rather than falling back to a direct call.
const dispatcherRemoval = await page.evaluate(async () => {
  const i = window.__inscribe;
  const saved = i.own;
  i.own = undefined; // simulate WebMCP absent entirely
  const result = await new Promise((resolve) => {
    const onMsg = (e) => {
      if (e.data?.source === 'inscribe-page' && e.data.type === 'execute-result') {
        window.removeEventListener('message', onMsg);
        resolve(e.data.payload.result);
      }
    };
    window.addEventListener('message', onMsg);
    window.postMessage({
      source: 'inscribe-ext', type: 'execute',
      payload: { name: 'inscribe.ui.theme', args: { mode: 'dark' }, callId: 'removal-1' },
    }, location.origin);
    setTimeout(() => resolve({ timedOut: true }), 5000);
  });
  i.own = saved;
  return result;
});
check('agent dispatcher errors (no direct-call fallback) when WebMCP is gone',
  Boolean(dispatcherRemoval?.isError) && /WebMCP unavailable/i.test(JSON.stringify(dispatcherRemoval)),
  JSON.stringify(dispatcherRemoval).slice(0, 120));

// ---------------------------------------------------------------- WRAP UP
section('9. No uncaught page errors during the suite');
check('zero pageerrors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

console.log(`\n${'='.repeat(52)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
console.log('='.repeat(52));

await ctx.close();
stop();
process.exit(failed ? 1 : 0);
