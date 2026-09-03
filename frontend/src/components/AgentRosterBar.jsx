import AgentSprite from './AgentSprite';
import React from 'react';
import { OFFICE_EXPERTS } from './BankOfficeSim';
import {
  AGENT_DOMAINS,
  AGENT_WORK_TASKS,
  PERSONA_TO_AGENT,
  agentStateFromEvents,
  decisionColor,
} from '../lib/agentMap';

export default function AgentRosterBar({
  selectedAgentId = null,
  onSelectAgent = () => {},
  events = [],
  activeAnomaly = null,
  loopRunning = false,
}) {
  // Confidence and status come from the agents' own WebSocket verdicts.
  // An agent that has not reported is shown as idle rather than given a number.
  // Only the market quorum drives this roster. The transaction pipeline
  // broadcasts the same event names under governance agent names, and
  // counting those here made the header report agents as reporting while
  // every card rendered idle.
  const agentState = agentStateFromEvents(events, { quorum: 'market' });
  const reporting = Object.keys(agentState).length;

  return (
    <div style={{ padding: '10px 14px' }}>
      {/* Top Header Ribbon */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '10px',
        paddingBottom: '8px',
        borderBottom: '1px solid var(--border-subtle)'
      }}>
        <div style={{ fontSize: '11px', fontWeight: '800', color: 'var(--text-primary)', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            background: 'linear-gradient(135deg, #0D2E37, #446E73)',
            color: '#FFFFFF',
            padding: '2px 7px',
            borderRadius: '4px',
            fontSize: '9px',
            fontWeight: '800',
            fontFamily: 'var(--font-mono)'
          }}>
            MARKET MoE
          </span>
          <span>PARALLEL MARKET QUORUM — 6 EXPERTS + SYNTHESIS</span>
        </div>
        <div style={{ fontSize: '10.5px', color: loopRunning ? '#0D7C66' : '#64748B', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--font-mono)' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: loopRunning ? '#0D7C66' : '#64748B', display: 'inline-block', boxShadow: loopRunning ? '0 0 6px rgba(13, 124, 102, 0.4)' : 'none' }} />
          {loopRunning ? `Loop running · ${reporting}/7 reporting` : 'Loop idle'}
        </div>
      </div>

      {/* Roster Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '8px',
        overflowX: 'auto'
      }}>
        {OFFICE_EXPERTS.map(agent => {
          const isSelected = selectedAgentId === agent.id;
          const agentName = PERSONA_TO_AGENT[agent.id];
          const live = agentState[agentName];
          const isAnomalyAlert = Boolean(
            activeAnomaly && live && live.decision === 'deny'
          );
          const workTask = AGENT_WORK_TASKS[agent.id] || 'ACTIVE';

          // The meter shows this agent's actual confidence in its last verdict.
          // With no verdict yet the meter is empty and the badge reads IDLE.
          const confidence = live && typeof live.confidence === 'number' ? live.confidence : null;
          const meterPct = confidence === null ? 0 : Math.round(confidence * 100);
          const meterColor = live && live.decision ? decisionColor(live.decision) : '#446E73';

          let badge = 'IDLE';
          if (live && live.status === 'working') badge = workTask;
          else if (live && live.decision) badge = live.decision.toUpperCase().slice(0, 7);

          return (
            <div
              key={agent.id}
              onClick={() => onSelectAgent(agent.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '7px 9px',
                borderRadius: '8px',
                backgroundColor: isSelected ? '#EBF4F5' : isAnomalyAlert ? '#FEF2F2' : '#F8FAFA',
                border: `1px solid ${isSelected ? '#0D2E37' : isAnomalyAlert ? '#EF4444' : 'var(--border-subtle)'}`,
                boxShadow: isSelected ? '0 0 0 1.5px #0D2E37, 0 2px 8px rgba(13, 46, 55, 0.12)' : isAnomalyAlert ? '0 0 0 1.5px #EF4444, 0 2px 8px rgba(239, 68, 68, 0.15)' : '0 1px 3px rgba(10, 27, 36, 0.03)',
                cursor: 'pointer',
                transition: 'all 0.18s ease'
              }}
              onMouseOver={(e) => {
                if (!isSelected && !isAnomalyAlert) {
                  e.currentTarget.style.backgroundColor = '#FFFFFF';
                  e.currentTarget.style.borderColor = 'var(--swatch-3-mineral)';
                  e.currentTarget.style.boxShadow = '0 3px 10px rgba(10, 27, 36, 0.08)';
                }
              }}
              onMouseOut={(e) => {
                if (!isSelected && !isAnomalyAlert) {
                  e.currentTarget.style.backgroundColor = '#F8FAFA';
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(10, 27, 36, 0.03)';
                }
              }}
            >
              {/* Agent Avatar Box */}
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '6px',
                border: `1px solid ${isAnomalyAlert ? '#EF4444' : 'var(--border-subtle)'}`,
                background: isAnomalyAlert ? '#FEE2E2' : '#EEF4F4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                overflow: 'hidden'
              }}>
                <AgentSprite
                  src={agent.spriteUrl}
                  size={30}
                  animated={Boolean(loopRunning && live && live.status === 'working')}
                  title={agent.name}
                />
              </div>

              {/* Agent Meta */}
              <div style={{ overflow: 'hidden', flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '10.5px', fontWeight: '800', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {agent.name.toUpperCase()}
                  </span>
                  <span style={{
                    fontSize: '8px',
                    fontWeight: '800',
                    fontFamily: 'var(--font-mono)',
                    padding: '1px 5px',
                    borderRadius: '3px',
                    backgroundColor: isAnomalyAlert ? '#FEE2E2' : '#E6F5F2',
                    color: isAnomalyAlert ? '#DC2626' : '#0D7C66',
                    border: `1px solid ${isAnomalyAlert ? '#FECACA' : (live ? '#A3DFD3' : '#CBD5E1')}`
                  }}>
                    {badge}
                  </span>
                </div>

                <div
                  title={AGENT_DOMAINS[agentName] || agent.title}
                  style={{ fontSize: '8.5px', fontWeight: '600', color: 'var(--text-muted)', marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {confidence === null ? agent.title : `${agent.title} · ${meterPct}%`}
                </div>

                {/* Confidence meter — reflects the agent's last real verdict */}
                <div style={{ width: '100%', height: '3.5px', background: '#DCE5E5', marginTop: '3px', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${meterPct}%`,
                    height: '100%',
                    background: meterColor,
                    transition: 'width 0.6s ease'
                  }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
