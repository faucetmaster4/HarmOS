/* HarmOS Voice Bridge — Web Speech API with explicit, honest capability detection.
 *
 * This module never pretends a microphone is listening. `probeVoice()` reports what the
 * browser actually supports, and the UI shows that result verbatim. Wake-word/always-on
 * capture is deliberately unsupported: recognition runs only while the operator holds
 * the control (push-to-talk).
 */

export type VoiceStatus = 'unsupported' | 'needs-permission' | 'ready' | 'listening' | 'denied' | 'error';

export interface VoiceCapabilities {
  speechRecognition: boolean;
  speechSynthesis: boolean;
  secureContext: boolean;
  mediaDevices: boolean;
  engineName: string;
  detail: string;
}

export interface TranscriptEntry {
  id: string;
  at: number;
  text: string;
  confidence: number;
  source: 'user' | 'system';
}

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type RecognitionCtor = new () => SpeechRecognitionLike;

export function probeVoice(): VoiceCapabilities {
  const w = globalThis as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
    speechSynthesis?: { getVoices(): Array<{ name: string; lang: string }> };
    isSecureContext?: boolean;
    mediaDevices?: { getUserMedia(c: unknown): Promise<unknown> };
  };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  const secure = w.isSecureContext === true;
  const synth = !!w.speechSynthesis;
  const parts: string[] = [];
  if (!Ctor) parts.push('no SpeechRecognition engine');
  if (!synth) parts.push('no speech synthesis');
  if (!secure) parts.push('insecure context (mic needs https or localhost)');
  if (!w.mediaDevices) parts.push('no mediaDevices');
  return {
    speechRecognition: !!Ctor,
    speechSynthesis: synth,
    secureContext: secure,
    mediaDevices: !!w.mediaDevices,
    engineName: Ctor ? (w.SpeechRecognition ? 'SpeechRecognition' : 'webkitSpeechRecognition') : 'none',
    detail: parts.length ? `Missing: ${parts.join('; ')}.` : 'All voice primitives present. Microphone permission is still requested separately, on first use.',
  };
}

export function listVoices(): Array<{ name: string; lang: string }> {
  const w = globalThis as unknown as { speechSynthesis?: { getVoices(): Array<{ name: string; lang: string }> } };
  if (!w.speechSynthesis) return [];
  try { return w.speechSynthesis.getVoices().slice(0, 12).map((v) => ({ name: v.name, lang: v.lang })); }
  catch { return []; }
}

export interface Listener {
  onPartial(text: string): void;
  onFinal(text: string, confidence: number): void;
  onError(message: string): void;
  onEnd(): void;
}

export class PushToTalk {
  private rec: SpeechRecognitionLike | null = null;
  private Ctor: RecognitionCtor | null = null;

  constructor(private listener: Listener) {
    const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    this.Ctor = w.SpeechRecognition || w.webkitSpeechRecognition || null;
  }

  get supported(): boolean { return !!this.Ctor; }

  start(lang = 'en-US'): void {
    if (!this.Ctor) { this.listener.onError('This browser has no SpeechRecognition engine. HarmOS will not fake a transcript.'); return; }
    if (this.rec) return;
    try {
      const rec = new this.Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = lang;
      rec.maxAlternatives = 1;
      rec.onresult = (evt: unknown) => {
        const e = evt as { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string; confidence: number } }> };
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) this.listener.onFinal(r[0].transcript.trim(), r[0].confidence || 0);
          else this.listener.onPartial(r[0].transcript);
        }
      };
      rec.onerror = (evt: unknown) => {
        const e = evt as { error: string };
        const map: Record<string, string> = {
          'not-allowed': 'Microphone permission denied. Enable it in the browser site settings.',
          'service-not-allowed': 'Recognition service blocked — often a browser policy or a missing secure context.',
          'no-speech': 'No speech detected in that window.',
          'audio-capture': 'No microphone found.',
          network: 'Recognition needs a network round-trip and the request failed.',
        };
        this.listener.onError(map[e.error] || `Recognition error: ${e.error}`);
      };
      rec.onend = () => { this.rec = null; this.listener.onEnd(); };
      rec.start();
      this.rec = rec;
    } catch (e) {
      this.rec = null;
      this.listener.onError(e instanceof Error ? e.message : String(e));
    }
  }

  stop(): void {
    try { this.rec?.stop(); } catch { /* already stopped */ }
    this.rec = null;
  }
}

export function speak(text: string, opts: { lang?: string; rate?: number; voiceName?: string } = {}): boolean {
  const w = globalThis as unknown as {
    speechSynthesis?: { speak(u: SpeechSynthesisUtterance): void; cancel(): void; getVoices(): SpeechSynthesisVoice[] };
  };
  if (!w.speechSynthesis) return false;
  try {
    w.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 600));
    u.lang = opts.lang || 'en-US';
    u.rate = opts.rate ?? 1;
    if (opts.voiceName) {
      const v = w.speechSynthesis.getVoices().find((x) => x.name === opts.voiceName);
      if (v) u.voice = v;
    }
    w.speechSynthesis.speak(u);
    return true;
  } catch { return false; }
}

export function stopSpeaking(): void {
  const w = globalThis as unknown as { speechSynthesis?: { cancel(): void } };
  try { w.speechSynthesis?.cancel(); } catch { /* ignore */ }
}

/** Strips filler so transcripts are useful as task input. */
export function cleanTranscript(t: string): string {
  // Collapse whitespace first, then drop leading filler words. The filler may be
  // followed by punctuation, a pause, or both — so consume word + punctuation + space.
  // Strip any run of leading filler words (people say "um, so, right," before a command),
  // each optionally followed by punctuation and a pause.
  const filler = /^\s*(?:um|uh|er|ah|so|okay|ok|right|well|like)\b[,.;:-]?\s*/i;
  let out = t.replace(/\s+/g, ' ').trim();
  let guard = 0;
  while (filler.test(out) && guard++ < 10) out = out.replace(filler, '').trim();
  return out;
}
