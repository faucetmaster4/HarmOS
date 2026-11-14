import { useMemo, useRef, useState } from 'react';
import { Btn, Field, KV, Panel, Tag, cx, inputCls, useKernel } from '../kit';
import {
  listVoices, probeVoice, speak, stopSpeaking, cleanTranscript, PushToTalk,
  type TranscriptEntry, type VoiceCapabilities,
} from '../../harmos/voice';

export function VoicePanel() {
  const k = useKernel();
  const [caps] = useState<VoiceCapabilities>(() => probeVoice());
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [status, setStatus] = useState(caps.detail);
  const [ttsOn, setTtsOn] = useState(false);
  const [lang, setLang] = useState('en-US');
  const voices = useMemo(() => listVoices(), []);
  const [voiceName, setVoiceName] = useState('');
  const ptt = useRef<PushToTalk | null>(null);
  const buffer = useRef('');

  const ensureListener = () => {
    if (ptt.current) return ptt.current;
    ptt.current = new PushToTalk({
      onPartial: (t) => setPartial(t),
      onFinal: (t, conf) => {
        const clean = cleanTranscript(t);
        buffer.current = `${buffer.current} ${clean}`.trim();
        setEntries((e) => [{ id: `t${Date.now()}`, at: Date.now(), text: clean, confidence: conf, source: 'user' as const }, ...e].slice(0, 100));
        setPartial('');
      },
      onError: (m) => { setStatus(m); setListening(false); },
      onEnd: () => { setListening(false); setPartial(''); },
    });
    return ptt.current;
  };

  const toggle = () => {
    const l = ensureListener();
    if (!l.supported) { setStatus('This browser has no SpeechRecognition engine. HarmOS will not fake a transcript — type into Nexus Terminal instead.'); return; }
    if (listening) { l.stop(); setListening(false); return; }
    buffer.current = '';
    l.start(lang);
    setListening(true);
    setStatus('Listening while held. Nothing is captured after you release — there is no always-on mode.');
  };

  const dispatch = () => {
    const text = buffer.current.trim();
    if (!text) { setStatus('Nothing captured to dispatch.'); return; }
    k.submit('nexus', `Voice input: ${text}`);
    k.log('info', 'voice', 'transcript.dispatch', `${text.length} chars to Nexus`);
    setStatus(`Dispatched ${text.length} characters to Nexus Terminal as a task.`);
    buffer.current = '';
  };

  const usable = caps.speechRecognition && caps.secureContext;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[12.5px] font-semibold text-slate-100">Voice bridge — push-to-talk</p>
          <Tag tone={usable ? 'ok' : 'warn'}>{caps.engineName === 'none' ? 'no engine detected' : caps.engineName}</Tag>
          {!caps.secureContext && <Tag tone="warn">insecure context — microphone blocked</Tag>}
          {ttsOn && <Tag tone="info">spoken replies on</Tag>}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">{status}</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          <Panel title="Capture" subtitle="Hold-to-talk. Recognition runs only while active; there is deliberately no wake-word or always-on mode.">
            <button
              onPointerDown={toggle}
              onPointerUp={() => { if (listening) { ptt.current?.stop(); setListening(false); } }}
              onPointerLeave={() => { if (listening) { ptt.current?.stop(); setListening(false); } }}
              disabled={!usable}
              className={cx('flex h-28 w-full flex-col items-center justify-center rounded-xl border-2 transition',
                listening ? 'border-rose-400/60 bg-rose-400/15' : usable ? 'border-cyan-400/40 bg-cyan-400/10 hover:bg-cyan-400/15' : 'cursor-not-allowed border-white/10 bg-black/30')}>
              <span className="text-3xl">{listening ? '●' : '🎤'}</span>
              <span className="mt-1 text-[12px] text-slate-200">{listening ? 'Listening — release to stop' : usable ? 'Hold to talk' : 'Voice unavailable in this browser'}</span>
            </button>
            {partial && <p className="mt-2 font-mono text-[11px] text-amber-300">…{partial}</p>}
            <p className="mt-2 min-h-[2.5rem] rounded-lg border border-white/10 bg-black/40 p-2 text-[12.5px] text-slate-200">{buffer.current || <span className="text-slate-600">Transcript appears here as phrases complete.</span>}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn tone="primary" onClick={dispatch} disabled={!buffer.current.trim()}>Dispatch to Nexus</Btn>
              <Btn onClick={() => { buffer.current = ''; setStatus('Buffer cleared. Nothing was submitted.'); }}>Clear</Btn>
              <Btn onClick={() => { setEntries([]); setStatus('Transcript history cleared.'); }}>Wipe history</Btn>
            </div>
          </Panel>

          <Panel title="Transcript history" subtitle="Kept in this session only unless you save it to the vault. Confidence is the browser's own value.">
            {entries.length === 0 && <p className="text-[12px] text-slate-500">Nothing transcribed yet.</p>}
            <div className="max-h-56 space-y-1 overflow-auto">
              {entries.map((e) => (
                <div key={e.id} className="border-b border-white/5 py-1">
                  <div className="flex items-center gap-2 text-[10px] text-slate-600">
                    <span>{new Date(e.at).toLocaleTimeString()}</span>
                    <span>confidence {(e.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <p className="text-[12px] text-slate-200">{e.text}</p>
                </div>
              ))}
            </div>
            {entries.length > 0 && (
              <Btn className="mt-2" onClick={() => {
                const p = '/home/harmos/HarmOS/outbox/voice-transcript.md';
                k.write('architect-core', p, ['# Voice transcript', '', ...entries.map((e) => `- \`${new Date(e.at).toISOString()}\` (${(e.confidence * 100).toFixed(0)}%) ${e.text}`)].join('\n'), 'user');
                setStatus(`Saved ${entries.length} entries to ${p}`);
              }}>Save to vault</Btn>
            )}
          </Panel>
        </div>

        <div className="space-y-2">
          <Panel title="Capabilities detected" subtitle="Reported verbatim from the browser. Nothing is assumed.">
            <KV k="Speech recognition" v={caps.speechRecognition ? 'yes' : 'no'} />
            <KV k="Speech synthesis" v={caps.speechSynthesis ? 'yes' : 'no'} />
            <KV k="Secure context" v={caps.secureContext ? 'yes' : 'no'} />
            <KV k="Media devices API" v={caps.mediaDevices ? 'yes' : 'no'} />
            <KV k="Engine" v={caps.engineName} />
            <p className="mt-2 text-[11px] text-slate-400">{caps.detail}</p>
          </Panel>

          <Panel title="Spoken replies" subtitle="Text-to-speech for Nexus responses. Off by default.">
            <label className="flex items-center gap-2 text-[12px] text-slate-200">
              <input type="checkbox" className="accent-cyan-400" checked={ttsOn} onChange={(e) => { setTtsOn(e.target.checked); if (!e.target.checked) stopSpeaking(); }} />
              Read Nexus replies aloud
            </label>
            <Field label="Language">
              <select className={inputCls} value={lang} onChange={(e) => setLang(e.target.value)}>
                {['en-US', 'en-GB', 'es-ES', 'fr-FR', 'de-DE', 'ja-JP'].map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            {voices.length > 0 && (
              <Field label={`Voice (${voices.length} installed)`}>
                <select className={inputCls} value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
                  <option value="">system default</option>
                  {voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                </select>
              </Field>
            )}
            <div className="flex gap-2">
              <Btn onClick={() => { const ok = speak('HarmOS voice bridge is working. This is a local speech synthesis test.', { lang, voiceName: voiceName || undefined }); setStatus(ok ? 'Test utterance spoken.' : 'Speech synthesis unavailable in this browser.'); }}>Test</Btn>
              <Btn tone="danger" onClick={stopSpeaking}>Stop</Btn>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
