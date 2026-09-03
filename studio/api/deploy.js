// Vercel Node.js Function: POST { files: { "/index.html": "...", ... }, name? }
// Creates a real preview deployment (via the Vercel REST API) from the files
// the agent built in the VFS, scoped to this same Vercel project.
//
// Requires VERCEL_ACCESS_TOKEN as a server-only env var. Never exposed to the
// client — this file only runs on Vercel's infrastructure.

const MAX_FILES = 30;
const MAX_FILE_BYTES = 200 * 1024; // 200KB per file
const MAX_TOTAL_BYTES = 2 * 1024 * 1024; // 2MB total

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const token = process.env.VERCEL_ACCESS_TOKEN;
  if (!token) {
    res.status(501).json({
      error: 'not_configured',
      message: 'VERCEL_ACCESS_TOKEN is not set on this deployment. Real deploy is disabled here.',
    });
    return;
  }

  const body = req.body || {};
  const files = body.files;

  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    res.status(400).json({ error: 'bad_request', message: '`files` must be an object of {path: content}.' });
    return;
  }

  const entries = Object.entries(files);
  if (entries.length === 0) {
    res.status(400).json({ error: 'bad_request', message: 'No files to deploy.' });
    return;
  }
  if (entries.length > MAX_FILES) {
    res.status(400).json({ error: 'bad_request', message: `Too many files (max ${MAX_FILES}).` });
    return;
  }

  let totalBytes = 0;
  const vercelFiles = [];
  for (const [path, content] of entries) {
    const str = typeof content === 'string' ? content : '';
    const bytes = Buffer.byteLength(str, 'utf8');
    if (bytes > MAX_FILE_BYTES) {
      res.status(400).json({ error: 'bad_request', message: `File too large: ${path}` });
      return;
    }
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      res.status(400).json({ error: 'bad_request', message: 'Total payload too large (max 2MB).' });
      return;
    }
    vercelFiles.push({
      file: path.replace(/^\/+/, ''),
      data: Buffer.from(str, 'utf8').toString('base64'),
      encoding: 'base64',
    });
  }

  const projectId = process.env.VERCEL_PROJECT_ID;
  const deployName = (body.name && String(body.name).slice(0, 50)) || 'inscribe-build';

  try {
    const upstream = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: deployName,
        project: projectId,
        files: vercelFiles,
        projectSettings: { framework: null },
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      res.status(502).json({
        error: 'upstream_error',
        message: (data && data.error && data.error.message) || 'Vercel API rejected the deployment.',
      });
      return;
    }

    res.status(200).json({
      ok: true,
      id: data.id,
      url: `https://${data.url}`,
      inspectorUrl: data.inspectorUrl,
      readyState: data.readyState,
    });
  } catch (err) {
    res.status(502).json({ error: 'upstream_error', message: err.message });
  }
};
