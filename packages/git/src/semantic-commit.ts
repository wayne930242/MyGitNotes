import path from 'node:path';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';
export const DETERMINISTIC_FALLBACK_MESSAGE = 'minor-mod';

export interface SemanticCommitOptions {
  apiKey?: string;
  model?: string;
  diff?: string;
  filePath?: string;
}

/**
 * Derives a deterministic fallback commit message based on modified file and diff size.
 */
export function getDeterministicFallback(filePath?: string, diff?: string): string {
  if (!filePath && !diff) {
    return DETERMINISTIC_FALLBACK_MESSAGE;
  }

  const lineCount = diff ? diff.split('\n').length : 0;
  if (lineCount < 10) {
    return DETERMINISTIC_FALLBACK_MESSAGE;
  }

  if (filePath) {
    const filename = path.basename(filePath, path.extname(filePath));
    return `docs(notes): update ${filename}`;
  }

  return 'docs(notes): update workspace notes';
}

/**
 * Generates a semantic commit message using Gemini Flash-Lite if an API key is available,
 * gracefully falling back to a deterministic message upon absence or error.
 */
export async function generateCommitMessage(options: SemanticCommitOptions): Promise<string> {
  const { apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL, diff = '', filePath } = options;

  const fallback = getDeterministicFallback(filePath, diff);

  // If no API key or empty diff, return fallback immediately
  if (!apiKey || !apiKey.trim() || !diff.trim()) {
    return fallback;
  }

  try {
    // Truncate diff if it's too large to prevent sending unnecessary payload
    const truncatedDiff = diff.length > 8000 ? diff.slice(0, 8000) + '\n[diff truncated]' : diff;

    const prompt = `You are an automated Git commit message generator. Based on the following Git diff, write a single concise conventional commit message (max 72 characters).
Do not include markdown code blocks, backticks, or quotes. Output only the commit message text.

Diff:
${truncatedDiff}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 60 } }), signal: controller.signal });

    clearTimeout(timeout);

    if (!response.ok) {
      return fallback;
    }

    const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; }>; }; }>; };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text) {
      // Clean up any extraneous quotes or formatting
      const cleaned = text.replace(/^["'`]+|["'`]+$/g, '').split('\n')[0].trim();
      return cleaned || fallback;
    }

    return fallback;
  } catch {
    // On any network or API error, fallback smoothly
    return fallback;
  }
}
