// Vercel Node.js Function (ESM): POST { command }
// Runs a shell command for real, inside an isolated, ephemeral Vercel
// Sandbox (a Firecracker microVM) — never in this function's own process.
// That isolation matters: this function's env carries real secrets
// (GROQ_API_KEY, OPENROUTER_API_KEY, VERCEL_ACCESS_TOKEN); the sandbox VM
// gets none of them, so even `env`/`printenv` inside the sandbox reveals
// nothing. Auth to Sandbox is automatic via OIDC on Vercel deployments.

import { Sandbox } from '@vercel/sandbox';

const MAX_COMMAND_LENGTH = 500;
const SANDBOX_TIMEOUT_MS = 20_000; // whole VM lifetime
const COMMAND_TIMEOUT_MS = 15_000; // SIGKILL if the command itself hangs
const MAX_OUTPUT_CHARS = 8000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const command = (req.body || {}).command;
  if (!command || typeof command !== 'string') {
    res.status(400).json({ error: 'bad_request', message: '`command` must be a non-empty string.' });
    return;
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    res.status(400).json({ error: 'bad_request', message: `Command too long (max ${MAX_COMMAND_LENGTH} chars).` });
    return;
  }

  let sandbox;
  try {
    sandbox = await Sandbox.create({ runtime: 'node24', timeout: SANDBOX_TIMEOUT_MS });

    const result = await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', command],
      timeoutMs: COMMAND_TIMEOUT_MS,
    });

    const [stdout, stderr] = await Promise.all([
      result.stdout().then((s) => s.slice(0, MAX_OUTPUT_CHARS)),
      result.stderr().then((s) => s.slice(0, MAX_OUTPUT_CHARS)),
    ]);

    res.status(200).json({ ok: true, exitCode: result.exitCode, stdout, stderr });
  } catch (err) {
    res.status(502).json({ error: 'sandbox_error', message: err.message });
  } finally {
    if (sandbox) {
      await sandbox.stop().catch(() => {});
    }
  }
}
