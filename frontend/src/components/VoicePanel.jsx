import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  Mic,
  Square,
  Play,
  Radio,
  AlertTriangle,
  CheckCircle2,
  Brain,
} from 'lucide-react';
import { api } from '../api';
import VoiceFraudRange from './VoiceFraudRange';
import { formatPct } from '../lib/agentMap';

/**
 * The ElevenLabs console.
 *
 * Two directions, deliberately asymmetric:
 *
 *   out — the desk speaks each executed action. Narration text is broadcast
 *         over the WebSocket whether or not audio is available, so the record
 *         exists even when synthesis fails.
 *   in  — spoken instructions may change the risk envelope or halt the desk.
 *         They cannot order a specific trade. Humans set the constraints; the
 *         agent decides what to do inside them.
 *
 * A spoken instruction is always interpreted and shown before it is applied.
 * Speech recognition is imperfect and these values govern how much capital is
 * at risk, so "fifty" misheard as "fifteen" must be catchable by eye.
 */
export default function VoicePanel({ voice, events = [], onError }) {
  const [narrations, setNarrations] = useState([]);
  const [autoPlay, setAutoPlay] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interpretation, setInterpretation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [briefing, setBriefing] = useState(null);

  const [status, setStatus] = useState(null);
  const [mode, setMode] = useState('desk');
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const playedRef = useRef(new Set());

  const configured = Boolean(voice?.configured);

  // Seed the feed with the current desk status, refreshed periodically. The
  // desk narrates actions, and until it takes one there is nothing to replay —
  // but an operator still wants to hear where things stand, so status is always
  // available as a speakable entry rather than leaving the panel silent.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const b = await api.getBriefing();
        if (!cancelled) setStatus(b.text);
      } catch {
        /* leave status absent rather than inventing one */
      }
    };
    load();
    const id = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Collect narration events off the live feed.
  useEffect(() => {
    const incoming = events
      .filter((e) => e.type === 'voice_narration')
      .map((e) => ({ ...e.data, receivedAt: e.receivedAt }));
    if (!incoming.length) return;

    setNarrations((prev) => {
      const seen = new Set(prev.map((n) => n.decision_id));
      const fresh = incoming.filter((n) => !seen.has(n.decision_id));
      return fresh.length ? [...fresh, ...prev].slice(0, 40) : prev;
    });
  }, [events]);

  // Speak new narrations as they arrive, when the operator has opted in.
  useEffect(() => {
    if (!autoPlay || !configured || !narrations.length) return;
    const latest = narrations[0];
    if (playedRef.current.has(latest.decision_id)) return;
    playedRef.current.add(latest.decision_id);
    api
      .fetchNarrationAudio(latest.decision_id)
      .then((url) => url && new Audio(url).play().catch(() => {}))
      .catch(() => {});
  }, [narrations, autoPlay, configured]);

  const play = useCallback(
    async (decisionId) => {
      try {
        const url = await api.fetchNarrationAudio(decisionId);
        if (url) new Audio(url).play();
        else onError?.('Audio unavailable for this decision.');
      } catch (e) {
        onError?.(e.message);
      }
    },
    [onError]
  );

  const speakBriefing = async () => {
    setBusy(true);
    try {
      const b = await api.getBriefing();
      setBriefing(b.text);
      if (configured) {
        const url = await api.speak(b.text);
        if (url) new Audio(url).play();
      }
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  };

  // --- Microphone capture -> ElevenLabs Scribe -> constraint parse ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setBusy(true);
        try {
          const { transcript: text } = await api.transcribe(blob);
          setTranscript(text || '');
          if (text) setInterpretation(await api.applySpokenConstraint(text, false));
        } catch (e) {
          onError?.(e.message);
        } finally {
          setBusy(false);
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch (e) {
      onError?.(`Microphone unavailable: ${e.message}`);
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  const interpret = async () => {
    setBusy(true);
    try {
      setInterpretation(await api.applySpokenConstraint(transcript, false));
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.applySpokenConstraint(transcript, true);
      setInterpretation(r);
      setTranscript('');
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Which half of the voice layer is on screen. The desk speaking its own
          decisions and the range screening someone else's are separate
          products of the same integration; stacked on one scroll each read as
          an afterthought of the other. */}
      <div
        className="pill-filter-group"
        style={{ padding: '3px', alignSelf: 'flex-start', backgroundColor: '#EEF4F4' }}
      >
        {[
          { id: 'desk', label: 'DESK VOICE' },
          { id: 'fraud', label: 'FRAUD RANGE' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            className={`pill-filter-btn ${mode === t.id ? 'active' : ''}`}
            style={{ fontSize: '10px', padding: '3px 12px', fontFamily: 'var(--font-mono)', fontWeight: 800 }}
            onClick={() => setMode(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mode === 'fraud' && <VoiceFraudRange onError={onError} />}

      {mode === 'desk' && (
      <>
      {/* Status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 14px',
          borderRadius: 'var(--radius-sm)',
          background: configured ? '#E6F5F2' : '#FFFBEB',
          border: `1px solid ${configured ? '#A3DFD3' : '#FDE68A'}`,
          color: configured ? '#0D7C66' : '#92400E',
          fontSize: '11.5px',
        }}
      >
        {configured ? <Volume2 size={14} /> : <VolumeX size={14} />}
        <div style={{ flex: 1 }}>
          <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px' }}>
            {configured ? 'ELEVENLABS CONNECTED' : 'VOICE UNAVAILABLE'}
          </strong>
          <div style={{ marginTop: '2px' }}>
            {configured
              ? `${voice.key_pool_size} key${voice.key_pool_size === 1 ? '' : 's'} in the pool · model ${voice.model_id}. Keys rotate automatically on a rate limit.`
              : voice?.reason || 'ELEVENLABS_API_KEY is not set.'}
          </div>
        </div>
      </div>

      {/* Narration out */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          <SectionTitle>Decision narration</SectionTitle>
          <div style={{ display: 'flex', gap: '6px' }}>
            <Btn
              onClick={() => setAutoPlay((v) => !v)}
              tone={autoPlay ? 'good' : 'neutral'}
              icon={<Radio size={12} />}
              label={autoPlay ? 'AUTO-SPEAK ON' : 'AUTO-SPEAK OFF'}
              disabled={!configured}
            />
            <Btn onClick={speakBriefing} disabled={busy} icon={<Volume2 size={12} />} label="SPEAK BRIEFING" />
          </div>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 10px 0', lineHeight: 1.45 }}>
          The desk speaks each executed action and why. The text is recorded whether or not audio
          is available, so a failed synthesis never loses the record.
        </p>

        {briefing && (
          <div style={quoteStyle}>
            <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '9.5px' }}>BRIEFING</strong>
            <div style={{ marginTop: '4px' }}>{briefing}</div>
          </div>
        )}

        {status && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '9px',
              padding: '9px 12px',
              background: '#EBF4F5',
              border: '1px solid #A3DFD3',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '8px',
            }}
          >
            <button
              onClick={speakBriefing}
              disabled={!configured || busy}
              title={configured ? 'Speak the current desk status' : 'Voice not configured'}
              style={{
                flexShrink: 0,
                width: 26,
                height: 26,
                borderRadius: '50%',
                border: '1px solid var(--border-subtle)',
                background: configured ? 'var(--swatch-2-deep)' : '#E2E8F0',
                color: configured ? '#FFFFFF' : 'var(--text-muted)',
                cursor: configured && !busy ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Play size={11} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: '#0D7C66', fontWeight: 800 }}>
                DESK STATUS · LIVE
              </div>
              <div style={{ fontSize: '11.5px', lineHeight: 1.45, marginTop: '2px' }}>{status}</div>
            </div>
          </div>
        )}

        {narrations.length === 0 ? (
          <Empty>
            No action narrated yet. The desk speaks when it executes a trade; press play above to
            hear where things stand in the meantime.
          </Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {narrations.map((n) => (
              <div
                key={n.decision_id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '9px',
                  padding: '9px 12px',
                  background: '#F8FAFA',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <button
                  onClick={() => play(n.decision_id)}
                  disabled={!n.audio_available}
                  title={n.audio_available ? 'Play' : 'Audio unavailable — voice not configured'}
                  style={{
                    flexShrink: 0,
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    border: '1px solid var(--border-subtle)',
                    background: n.audio_available ? 'var(--swatch-2-deep)' : '#E2E8F0',
                    color: n.audio_available ? '#FFFFFF' : 'var(--text-muted)',
                    cursor: n.audio_available ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Play size={11} />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                    {n.symbol} · {n.receivedAt ? new Date(n.receivedAt).toLocaleTimeString() : ''}
                  </div>
                  <div style={{ fontSize: '11.5px', lineHeight: 1.45, marginTop: '2px' }}>{n.text}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Constraints in */}
      <section>
        <SectionTitle>Spoken instruction</SectionTitle>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 10px 0', lineHeight: 1.45 }}>
          Say what the limits should be — &ldquo;cap exposure at forty percent&rdquo;, &ldquo;stop me
          at eight percent down&rdquo;, &ldquo;halt trading&rdquo;. An instruction can change the
          envelope or halt the desk; it cannot order a specific trade. Every instruction is
          interpreted and shown to you before anything changes, and values are clamped to a
          permitted range, so a misheard number cannot hand the agent more risk than allowed.
        </p>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {recording ? (
            <Btn onClick={stopRecording} tone="bad" icon={<Square size={12} />} label="STOP & TRANSCRIBE" />
          ) : (
            <Btn
              onClick={startRecording}
              disabled={!configured || busy}
              icon={<Mic size={12} />}
              label="RECORD"
              title={configured ? 'Record a spoken instruction' : 'Transcription needs an ElevenLabs key'}
            />
          )}
          <input
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="or type it: cap exposure at forty percent"
            style={{
              flex: 1,
              minWidth: '240px',
              padding: '7px 10px',
              fontSize: '12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              background: '#FFFFFF',
            }}
          />
          <Btn onClick={interpret} disabled={!transcript.trim() || busy} icon={<Brain size={12} />} label="INTERPRET" />
          <Btn
            onClick={apply}
            disabled={!interpretation || !transcript.trim() || busy}
            tone="good"
            icon={<CheckCircle2 size={12} />}
            label="CONFIRM & APPLY"
          />
        </div>

        {recording && (
          <div style={{ marginTop: '8px', fontSize: '11px', color: '#DC2626', fontFamily: 'var(--font-mono)' }}>
            ● Recording — press stop when finished.
          </div>
        )}

        {interpretation && (
          <div style={{ ...quoteStyle, marginTop: '10px' }}>
            <div><strong>Understood as:</strong> {interpretation.understood_as || '—'}</div>
            <div><strong>Confidence:</strong> {formatPct(interpretation.confidence, 0)}</div>
            <div>
              <strong>Constraints:</strong>{' '}
              {Object.keys(interpretation.constraints || {}).length
                ? JSON.stringify(interpretation.constraints)
                : 'none'}
            </div>
            <div><strong>Command:</strong> {interpretation.command}</div>
            {interpretation.applied === false && (
              <div style={{ color: '#92400E', marginTop: '4px' }}>
                Dry run — nothing changed. Press Confirm &amp; Apply to commit.
              </div>
            )}
            {interpretation.result?.rejected &&
              Object.keys(interpretation.result.rejected).length > 0 && (
                <div style={{ color: '#DC2626', marginTop: '4px' }}>
                  <strong>Rejected:</strong> {JSON.stringify(interpretation.result.rejected)}
                </div>
              )}
            {interpretation.command_result && (
              <div style={{ color: '#0D7C66', marginTop: '4px' }}>{interpretation.command_result}</div>
            )}
          </div>
        )}
      </section>
      </>
      )}
    </div>
  );
}

function Btn({ onClick, disabled, icon, label, tone = 'neutral', title }) {
  const palette = {
    good: { bg: '#0D7C66', fg: '#FFFFFF', bd: '#0D7C66' },
    bad: { bg: '#DC2626', fg: '#FFFFFF', bd: '#DC2626' },
    neutral: { bg: '#F8FAFA', fg: 'var(--swatch-2-deep)', bd: 'var(--border-subtle)' },
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        padding: '6px 11px',
        fontSize: '9.5px',
        fontWeight: 800,
        fontFamily: 'var(--font-mono)',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${palette.bd}`,
        background: palette.bg,
        color: palette.fg,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Empty({ children }) {
  return (
    <div
      style={{
        padding: '22px 16px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: '11.5px',
        lineHeight: 1.5,
        background: '#F8FAFA',
        border: '1px dashed var(--border-subtle)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h3
      style={{
        margin: '0 0 6px 0',
        fontSize: '11px',
        fontWeight: 800,
        fontFamily: 'var(--font-mono)',
        color: 'var(--swatch-2-deep)',
        textTransform: 'uppercase',
        letterSpacing: '0.4px',
      }}
    >
      {children}
    </h3>
  );
}

const quoteStyle = {
  padding: '10px 12px',
  background: '#F8FAFA',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  fontSize: '11px',
  fontFamily: 'var(--font-mono)',
  lineHeight: 1.55,
  marginBottom: '10px',
};
