// Vercel Node.js Function (ESM): POST { prompt }
// Real image generation via OpenRouter's multimodal image models (checked
// live against OpenRouter's own model catalog for `output_modalities`
// including "image" — not guessed). Billed to OPENROUTER_API_KEY's own
// account, same as the text agent's OpenRouter models.

import { generateImage } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';

const MODEL_ID = 'google/gemini-2.5-flash-image';
const MAX_PROMPT_LENGTH = 500;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    res.status(501).json({ error: 'not_configured', message: 'OPENROUTER_API_KEY is not set on this deployment.' });
    return;
  }

  const prompt = (req.body || {}).prompt;
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'bad_request', message: '`prompt` must be a non-empty string.' });
    return;
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    res.status(400).json({ error: 'bad_request', message: `Prompt too long (max ${MAX_PROMPT_LENGTH} chars).` });
    return;
  }

  try {
    const { image } = await generateImage({
      model: openrouter.imageModel(MODEL_ID),
      prompt,
    });

    res.status(200).json({
      ok: true,
      base64: image.base64,
      mediaType: image.mediaType || 'image/png',
    });
  } catch (err) {
    res.status(502).json({ error: 'image_error', message: err.message });
  }
}
