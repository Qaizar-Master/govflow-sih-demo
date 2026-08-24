import { env } from '@govflow/contracts';
import { createLogger } from '../logger.js';

const log = createLogger('gemini');

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 12_000;

export function isAiEnabled(): boolean {
  return env.aiEnabled;
}

export const AI_UNAVAILABLE_NOTE =
  'AI service unavailable - rule-based validation used.';

/**
 * Single, narrow Gemini call: prompt in, parsed JSON out.
 *
 * Returns null on *any* problem - missing key, network error, timeout, non-JSON
 * response. Callers treat null as "AI is not available right now" and fall back
 * to the deterministic engine, so GovFlow never becomes unusable because of AI.
 */
export async function generateJson<T>(
  systemInstruction: string,
  userPrompt: string,
  responseSchema?: Record<string, unknown>,
): Promise<T | null> {
  if (!isAiEnabled()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      `${ENDPOINT}/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            ...(responseSchema ? { responseSchema } : {}),
          },
        }),
      },
    );

    if (!res.ok) {
      // Never log the response body: it can echo the prompt back.
      log.warn('gemini call rejected', { status: res.status });
      return null;
    }

    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      log.warn('gemini returned no candidate text');
      return null;
    }
    return JSON.parse(text) as T;
  } catch (error) {
    log.warn('gemini call failed, falling back to rules', {
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
