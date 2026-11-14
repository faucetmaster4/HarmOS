/* HarmOS model layer — real network calls only.
 *
 * Nothing here simulates a model. If no provider is reachable, callers get an error
 * and the UI says "no model configured" instead of inventing a reply.
 * Credentials are read from the kernel's volatile secret map at call time and are
 * never written into task logs, state or exports.
 */
import type { Kernel, ProviderConfig } from './kernel';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatResult { text: string; tokensIn: number; tokensOut: number; costUsd?: number; source: string }

const timeout = (ms: number) => {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
};

/** Probe a local Ollama daemon. Returns the real tag list or throws. */
export async function probeOllama(baseUrl = 'http://127.0.0.1:11434'): Promise<string[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal: timeout(4000) });
  if (!res.ok) throw new Error(`Ollama responded ${res.status}`);
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  return (data.models || []).map((m) => m.name);
}

export async function probeProvider(k: Kernel, p: ProviderConfig): Promise<{ ok: boolean; note: string; models?: string[] }> {
  try {
    if (p.kind === 'ollama') {
      const models = await probeOllama(p.baseUrl);
      return { ok: true, note: `reachable — ${models.length} local model(s)`, models };
    }
    const key = k.getSecret(p.id);
    if (!key) return { ok: false, note: 'no credential stored for this provider' };
    if (p.kind === 'anthropic') {
      const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/v1/models`, {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: timeout(8000),
      });
      return { ok: res.ok, note: res.ok ? 'credential accepted' : `HTTP ${res.status}` };
    }
    if (p.kind === 'google') {
      const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/v1beta/models?key=${encodeURIComponent(key)}`, { signal: timeout(8000) });
      return { ok: res.ok, note: res.ok ? 'credential accepted' : `HTTP ${res.status}` };
    }
    const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/models`, {
      headers: { authorization: `Bearer ${key}` }, signal: timeout(8000),
    });
    return { ok: res.ok, note: res.ok ? 'credential accepted' : `HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, note: msg.includes('abort') ? 'timed out (no response in 8s)' : `unreachable: ${msg}` };
  }
}

export async function chat(k: Kernel, p: ProviderConfig, messages: ChatMessage[], onToken?: (t: string) => void): Promise<ChatResult> {
  const base = p.baseUrl.replace(/\/$/, '');

  if (p.kind === 'ollama') {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: p.model, messages, stream: false }), signal: timeout(180000),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const d = await res.json() as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    const text = d.message?.content ?? '';
    onToken?.(text);
    return { text, tokensIn: d.prompt_eval_count ?? 0, tokensOut: d.eval_count ?? 0, source: `ollama:${p.model}` };
  }

  const key = k.getSecret(p.id);
  if (!key) throw new Error('No credential stored for this provider. Add one in the AI Model Manager.');

  if (p.kind === 'anthropic') {
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: p.model, max_tokens: 2048, system: sys || undefined, messages: messages.filter((m) => m.role !== 'system') }),
      signal: timeout(180000),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const d = await res.json() as { content?: Array<{ text?: string }>; usage?: { input_tokens: number; output_tokens: number } };
    const text = (d.content || []).map((c) => c.text || '').join('');
    onToken?.(text);
    return { text, tokensIn: d.usage?.input_tokens ?? 0, tokensOut: d.usage?.output_tokens ?? 0, source: `anthropic:${p.model}` };
  }

  if (p.kind === 'google') {
    const res = await fetch(`${base}/v1beta/models/${encodeURIComponent(p.model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) }),
      signal: timeout(180000),
    });
    if (!res.ok) throw new Error(`Google ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const d = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number } };
    const text = (d.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
    onToken?.(text);
    return { text, tokensIn: d.usageMetadata?.promptTokenCount ?? 0, tokensOut: d.usageMetadata?.candidatesTokenCount ?? 0, source: `google:${p.model}` };
  }

  // OpenAI-compatible (also OpenRouter and custom endpoints)
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: p.model, messages, stream: false }),
    signal: timeout(180000),
  });
  if (!res.ok) throw new Error(`${p.label} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens: number; completion_tokens: number; cost?: number } };
  const text = d.choices?.[0]?.message?.content ?? '';
  onToken?.(text);
  return { text, tokensIn: d.usage?.prompt_tokens ?? 0, tokensOut: d.usage?.completion_tokens ?? 0, costUsd: d.usage?.cost, source: `${p.kind}:${p.model}` };
}

export const PROVIDER_PRESETS: Array<Omit<ProviderConfig, 'id' | 'hasKey' | 'reachable'>> = [
  { kind: 'ollama', label: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434', model: 'llama3.2:3b', note: 'Runs entirely on the guest. No credential required.' },
  { kind: 'openai-compatible', label: 'OpenAI-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { kind: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-sonnet' },
  { kind: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-20250514' },
  { kind: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.0-flash' },
];
