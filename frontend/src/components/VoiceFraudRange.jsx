import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ShieldAlert,
  Play,
  Volume2,
  Fingerprint,
  ScanLine,
  AlertTriangle,
  CheckCircle2,
  Brain,
  Hash,
  PhoneCall,
} from 'lucide-react';
import { api } from '../api';
import { formatMoney } from '../lib/agentMap';

/**
 * Synthetic voice fraud range.
 *
 * Voice cloning turned "a call from the CFO" into a live attack on treasury
 * operations, and it is the one attack the transaction pipeline cannot see:
 * by the time the instruction becomes a payment it already looks authorised.
 * This panel drives the control that has to sit on the call — generate a
 * scripted attack with ElevenLabs, then put it through the same screen an
 * inbound recording would face.
 *
 * The panel reports the two checks separately on purpose. A hash match proves
 * the clip came out of this range and generalises to nothing; the linguistic
 * screen generalises to a real call and proves nothing about the audio. Rolling
 * them into one number would hide exactly the distinction that matters.
 */

const VERDICT_STYLE = {
  synthetic_confirmed: { bg: '#FEF2F2', bd: '#FCA5A5', fg: '#B91C1C', label: 'SYNTHETIC — CONFIRMED' },
  fraudulent_instruction: { bg: '#FEF2F2', bd: '#FCA5A5', fg: '#B91C1C', label: 'FRAUDULENT INSTRUCTION' },
  requires_verification: { bg: '#FFF8E6', bd: '#FCD34D', fg: '#B76E00', label: 'REQUIRES VERIFICATION' },
  consistent_with_genuine: { bg: '#E6F5F2', bd: '#A3DFD3', fg: '#0D7C66', label: 'CONSISTENT WITH GENUINE' },
};

const INDICATOR_LABEL = {
  manufactured_urgency: 'Manufactured urgency',
  claimed_authority: 'Claimed authority',
  secrecy: 'Requested secrecy',
  control_bypass: 'Control bypass',
  beneficiary_change: 'Beneficiary change',
  credential_request: 'Credential request',
  fear_of_loss: 'Fear of loss',
  personal_liability_offer: 'Offered personal liability',
};

export default function VoiceFraudRange({ onError = () => {} }) {
  const [status, setStatus] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [deep, setDeep] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [clipUrl, setClipUrl] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    api.getFraudRangeStatus().then(setStatus).catch(() => setStatus(null));
    api
      .getFraudScenarios()
      .then((d) => {
        setScenarios(d.scenarios || []);
        if (d.scenarios?.length) setSelected(d.scenarios[0].id);
      })
      .catch(() => setScenarios([]));
  }, []);

  // The object URL is revoked when it is replaced, so a long session does not
  // accumulate a blob per run.
  useEffect(() => () => { if (clipUrl) URL.revokeObjectURL(clipUrl); }, [clipUrl]);

  const runScenario = useCallback(async () => {
    if (!selected) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await api.runFraudScenario(selected, deep);
      setResult(res);

      // Fetch the audio separately so the operator can hear the attack that
      // was just screened. A failure here must not discard the verdict.
      try {
        const url = await api.fetchFraudClip(selected);
        setClipUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch {
        /* verdict stands without playback */
      }
    } catch (e) {
      onError(e.message);
    } finally {
      setRunning(false);
    }
  }, [selected, deep, onError]);

  const screenText = useCallback(async () => {
    if (!transcript.trim()) return;
    setRunning(true);
    setResult(null);
    try {
      setResult(await api.screenFraudTranscript(transcript.trim(), true));
    } catch (e) {
      onError(e.message);
    } finally {
      setRunning(false);
    }
  }, [transcript, onError]);

  const scenario = scenarios.find((s) => s.id === selected);

  if (status && !status.configured) {
    return (
      <Callout tone="warn">
        The range is unavailable: {status.reason}. Set <code>ELEVENLABS_API_KEY</code> to
        synthesise calls. The linguistic screen still works on a pasted transcript.
      </Callout>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <Header status={status} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)',
          gap: '14px',
          alignItems: 'start',
        }}
      >
        {/* Scenario picker */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Label>Attack library</Label>
          {scenarios.map((s) => {
            const isControl = !s.tactics?.length;
            const active = selected === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                style={{
                  textAlign: 'left',
                  padding: '9px 11px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  background: active ? 'rgba(125, 174, 170, 0.14)' : '#F8FAFA',
                  border: `1px solid ${active ? 'rgba(125, 174, 170, 0.6)' : 'var(--border-subtle)'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {isControl ? (
                    <CheckCircle2 size={12} color="#0D7C66" />
                  ) : (
                    <ShieldAlert size={12} color="#DC2626" />
                  )}
                  <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {s.title}
                  </span>
                </div>
                <div style={{ fontSize: '9.5px', color: 'var(--text-muted)', marginTop: '3px' }}>
                  Impersonates: {s.impersonates}
                </div>
                {s.amount > 0 && (
                  <div
                    style={{
                      fontSize: '10px',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 800,
                      color: 'var(--swatch-2-deep)',
                      marginTop: '2px',
                    }}
                  >
                    {formatMoney(s.amount, 0, 'INR')} → {s.beneficiary}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Run + result */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              flexWrap: 'wrap',
              padding: '10px 12px',
              background: '#F8FAFA',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <button
              onClick={runScenario}
              disabled={running || !selected}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid #0D2E37',
                background: running ? '#94A3B8' : '#0D2E37',
                color: '#FFFFFF',
                fontSize: '10.5px',
                fontWeight: 800,
                fontFamily: 'var(--font-mono)',
                cursor: running ? 'wait' : 'pointer',
              }}
            >
              <Play size={12} />
              {running ? 'RUNNING…' : 'SYNTHESISE & SCREEN'}
            </button>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '10px',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              title="Adds the model's judgement of intent. Slower — the local runtime can take most of a minute — and the deterministic screen already returns a verdict without it."
            >
              <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
              <Brain size={12} /> model judgement
            </label>

            {clipUrl && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Volume2 size={13} color="var(--swatch-3-mineral)" />
                <audio ref={audioRef} src={clipUrl} controls style={{ height: '28px' }} />
              </div>
            )}
          </div>

          {scenario && !result && !running && (
            <Callout tone="info">
              <strong>{scenario.title}.</strong> {scenario.impersonates === 'none — this is the negative control'
                ? 'The negative control: a genuine routine instruction, synthesised the same way. It should clear the linguistic screen while still being recognised as synthetic by provenance — which is exactly the distinction this panel exists to show.'
                : `A caller claiming to be ${scenario.claimed_name} on an ${scenario.channel}. All parties are fictional and the clip is stamped as a drill.`}
            </Callout>
          )}

          {running && <Callout tone="info">Synthesising with ElevenLabs, then screening…</Callout>}

          {result && <Result result={result} />}

          {/* Free-text screen — the part that generalises past this range */}
          <div>
            <Label>Screen an instruction this range did not generate</Label>
            <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '2px 0 6px 0', lineHeight: 1.45 }}>
              Paste what a caller said. Provenance will miss, which is the point — the verdict then
              rests entirely on the structure of the request.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="This is the finance director. Move 80 lakh to the new account within the hour and don't discuss it with anyone…"
                rows={3}
                className="form-input"
                style={{ flex: 1, fontSize: '11px', resize: 'vertical' }}
              />
              <button
                onClick={screenText}
                disabled={running || !transcript.trim()}
                style={{
                  alignSelf: 'stretch',
                  padding: '0 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  background: '#FFFFFF',
                  color: 'var(--swatch-2-deep)',
                  fontSize: '10px',
                  fontWeight: 800,
                  fontFamily: 'var(--font-mono)',
                  cursor: running ? 'wait' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <ScanLine size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                SCREEN
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Header({ status }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '11px 14px',
        borderRadius: 'var(--radius-sm)',
        background: 'linear-gradient(135deg, #0A1B24 0%, #0D2E37 60%, #153C45 100%)',
        color: '#FFFFFF',
      }}
    >
      <PhoneCall size={16} color="var(--swatch-4-mint)" style={{ marginTop: 2, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '11.5px', fontWeight: 800, fontFamily: 'var(--font-mono)', letterSpacing: '0.4px' }}>
          SYNTHETIC VOICE FRAUD RANGE
        </div>
        <div style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.72)', marginTop: '3px', lineHeight: 1.5 }}>
          A cloned voice authorising a wire is the one instruction the transaction controls never
          see — by the time it reaches them it looks properly approved. The range generates the
          call, then screens it. Detection is provenance plus a linguistic screen of what was
          actually asked for; no acoustic deepfake analysis is performed, and none is claimed.
        </div>
      </div>
      {status && (
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '8.5px', color: 'rgba(255,255,255,0.55)', fontFamily: 'var(--font-mono)' }}>
            CLIPS ISSUED
          </div>
          <div style={{ fontSize: '17px', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
            {status.clips_issued}
          </div>
        </div>
      )}
    </div>
  );
}

function Result({ result }) {
  const style = VERDICT_STYLE[result.verdict] || VERDICT_STYLE.requires_verification;
  const lang = result.language || {};
  const intent = result.intent || {};
  const prov = result.provenance || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Verdict */}
      <div
        style={{
          padding: '12px 14px',
          borderRadius: 'var(--radius-sm)',
          background: style.bg,
          border: `1px solid ${style.bd}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <AlertTriangle size={14} color={style.fg} />
            <span style={{ fontSize: '12px', fontWeight: 800, color: style.fg, fontFamily: 'var(--font-mono)', letterSpacing: '0.3px' }}>
              {style.label}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>RISK</span>
            <span style={{ fontSize: '19px', fontWeight: 800, color: style.fg, fontFamily: 'var(--font-mono)' }}>
              {(result.risk_score * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-primary)', marginTop: '6px', lineHeight: 1.5 }}>
          {result.headline}
        </div>
        <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '6px', lineHeight: 1.5 }}>
          <strong>Next step:</strong> {result.action}
        </div>
        <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '6px', fontFamily: 'var(--font-mono)' }}>
          BASIS: {(result.basis || []).join(' + ')} · {result.elapsed_ms?.toFixed?.(0) ?? '—'}ms
        </div>
      </div>

      {/* The two checks, side by side and never merged */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '10px' }}>
        <Check
          icon={<Fingerprint size={13} color={prov.known_synthetic ? '#B91C1C' : 'var(--text-muted)'} />}
          title="Provenance"
          verdict={prov.known_synthetic ? 'HASH MATCH — SYNTHETIC' : 'NO RECORD'}
          verdictColor={prov.known_synthetic ? '#B91C1C' : 'var(--text-muted)'}
        >
          <div style={{ fontSize: '10px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{prov.note}</div>
          {result.audio_sha256 && (
            <div
              style={{
                marginTop: '6px',
                fontSize: '8.5px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
                wordBreak: 'break-all',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '4px',
              }}
            >
              <Hash size={10} style={{ flexShrink: 0, marginTop: 1 }} />
              {result.audio_sha256}
            </div>
          )}
        </Check>

        <Check
          icon={<ScanLine size={13} color={lang.score > 0.3 ? '#B91C1C' : '#0D7C66'} />}
          title="Linguistic screen"
          verdict={`${((lang.score || 0) * 100).toFixed(0)}% PRESSURE`}
          verdictColor={lang.score > 0.3 ? '#B91C1C' : '#0D7C66'}
        >
          {lang.indicators?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {lang.indicators.map((h) => (
                <div key={h.indicator} title={h.why} style={{ fontSize: '10px', lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 700, color: '#B91C1C' }}>
                    {INDICATOR_LABEL[h.indicator] || h.indicator}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}> — “{h.matched}”</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              No pressure indicators. The request does not resist verification, name urgency, ask
              for secrecy, or redirect a beneficiary.
            </div>
          )}
        </Check>
      </div>

      {/* Model judgement */}
      <Check
        icon={<Brain size={13} color={intent.available ? 'var(--swatch-2-deep)' : 'var(--text-muted)'} />}
        title="Model judgement of intent"
        verdict={intent.available ? `${intent.decision?.toUpperCase()} · ${((intent.confidence || 0) * 100).toFixed(0)}%` : 'NOT RUN'}
        verdictColor={intent.available ? (intent.decision === 'deny' ? '#B91C1C' : 'var(--swatch-2-deep)') : 'var(--text-muted)'}
      >
        <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {intent.available ? intent.reasoning : intent.error}
        </div>
        {intent.risk_flags?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
            {intent.risk_flags.map((f, fi) => (
              <span
                key={`${f}-${fi}`}
                style={{
                  fontSize: '8.5px',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: '3px',
                  background: '#FEF2F2',
                  color: '#B91C1C',
                  border: '1px solid #FCA5A5',
                }}
              >
                {f}
              </span>
            ))}
          </div>
        )}
      </Check>

      {/* Transcript */}
      {result.transcript && (
        <div>
          <Label>What was said</Label>
          <div
            style={{
              fontSize: '11px',
              lineHeight: 1.6,
              color: 'var(--text-primary)',
              background: '#FFFFFF',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              fontStyle: 'italic',
            }}
          >
            “{result.transcript}”
          </div>
        </div>
      )}

      <div style={{ fontSize: '9.5px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        <strong>Limits.</strong> {result.limits}
      </div>
    </div>
  );
}

function Check({ icon, title, verdict, verdictColor, children }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 'var(--radius-sm)',
        background: '#F8FAFA',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {icon}
          <span
            style={{
              fontSize: '10px',
              fontWeight: 800,
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              color: 'var(--text-primary)',
            }}
          >
            {title}
          </span>
        </div>
        <span style={{ fontSize: '9px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: verdictColor }}>
          {verdict}
        </span>
      </div>
      {children}
    </div>
  );
}

function Label({ children }) {
  return (
    <div
      style={{
        fontSize: '10px',
        fontWeight: 800,
        fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase',
        letterSpacing: '0.4px',
        color: 'var(--text-muted)',
        marginBottom: '6px',
      }}
    >
      {children}
    </div>
  );
}

function Callout({ tone = 'info', children }) {
  const tones = {
    info: { bg: '#F8FAFA', bd: 'var(--border-subtle)', fg: 'var(--text-secondary)' },
    warn: { bg: '#FFF8E6', bd: '#FCD34D', fg: '#B76E00' },
  };
  const t = tones[tone] || tones.info;
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 'var(--radius-sm)',
        background: t.bg,
        border: `1px solid ${t.bd}`,
        color: t.fg,
        fontSize: '10.5px',
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
}
