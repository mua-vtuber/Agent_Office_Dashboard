import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../stores/ui-store';
import { useAgentStore } from '../stores/agent-store';
import { toggleClickThrough, getAgentResume } from '../tauri/commands';
import { useErrorStore } from '../stores/error-store';
import type { MascotAgent, EmploymentType } from '../types/agent';
import type { AgentResume, ResumeEvent } from '../types/ipc';

// ---------------------------------------------------------------------------
// Tab filter type
// ---------------------------------------------------------------------------
type TabFilter = 'all' | 'employee' | 'contractor';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2000,
  background: 'rgba(0, 0, 0, 0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'auto',
};

const panelStyle: CSSProperties = {
  background: '#1a1a2e',
  borderRadius: 12,
  width: '90vw',
  maxWidth: 640,
  maxHeight: '80vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 20px',
  borderBottom: '1px solid rgba(255,255,255,0.1)',
};

const titleStyle: CSSProperties = {
  color: '#fff',
  fontSize: 18,
  fontWeight: 'bold',
  margin: 0,
};

const closeBtnStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.1)',
  border: 'none',
  color: '#fff',
  fontSize: 18,
  width: 32,
  height: 32,
  borderRadius: 6,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const tabBarStyle: CSSProperties = {
  display: 'flex',
  gap: 0,
  borderBottom: '1px solid rgba(255,255,255,0.1)',
};

const tabBaseStyle: CSSProperties = {
  flex: 1,
  padding: '10px 0',
  background: 'transparent',
  border: 'none',
  color: 'rgba(255,255,255,0.5)',
  fontSize: 14,
  cursor: 'pointer',
  transition: 'color 0.15s, border-bottom 0.15s',
  borderBottom: '2px solid transparent',
};

const tabActiveExtra: CSSProperties = {
  color: '#fff',
  borderBottomColor: '#6366f1',
};

const bodyStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '12px 20px 20px',
};

const workspaceHeaderStyle: CSSProperties = {
  color: 'rgba(255,255,255,0.4)',
  fontSize: 11,
  fontWeight: 'bold',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginTop: 16,
  marginBottom: 8,
  paddingBottom: 4,
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const cardStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  borderRadius: 8,
  padding: '10px 14px',
  marginBottom: 8,
  cursor: 'pointer',
  transition: 'background 0.15s',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const cardNameStyle: CSSProperties = {
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
};

const cardMetaStyle: CSSProperties = {
  color: 'rgba(255,255,255,0.5)',
  fontSize: 12,
};

const badgeStyle: CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 10,
  fontWeight: 600,
  marginLeft: 'auto',
  whiteSpace: 'nowrap',
};

const detailHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 16,
};

const backBtnStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.1)',
  border: 'none',
  color: '#fff',
  fontSize: 14,
  padding: '4px 12px',
  borderRadius: 6,
  cursor: 'pointer',
};

const detailNameStyle: CSSProperties = {
  color: '#fff',
  fontSize: 18,
  fontWeight: 'bold',
};

const detailSectionTitle: CSSProperties = {
  color: 'rgba(255,255,255,0.4)',
  fontSize: 12,
  fontWeight: 'bold',
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  marginTop: 16,
  marginBottom: 8,
};

const statRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '6px 0',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  color: 'rgba(255,255,255,0.8)',
  fontSize: 13,
};

const statLabelStyle: CSSProperties = {
  color: 'rgba(255,255,255,0.5)',
};

const eventRowStyle: CSSProperties = {
  padding: '8px 0',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};

const eventTypeStyle: CSSProperties = {
  fontSize: 11,
  color: '#6366f1',
  fontWeight: 600,
  textTransform: 'uppercase',
};

const eventSummaryStyle: CSSProperties = {
  color: 'rgba(255,255,255,0.8)',
  fontSize: 13,
  marginTop: 2,
};

const eventTsStyle: CSSProperties = {
  color: 'rgba(255,255,255,0.3)',
  fontSize: 11,
  marginTop: 2,
};

const emptyStyle: CSSProperties = {
  color: 'rgba(255,255,255,0.3)',
  fontSize: 14,
  textAlign: 'center',
  padding: 32,
};

// ---------------------------------------------------------------------------
// Status badge color helper
// ---------------------------------------------------------------------------
function statusBadgeColors(status: string): { bg: string; fg: string } {
  switch (status) {
    case 'working':
    case 'thinking':
      return { bg: 'rgba(34,197,94,0.2)', fg: '#22c55e' };
    case 'idle':
    case 'resting':
      return { bg: 'rgba(250,204,21,0.2)', fg: '#facc15' };
    case 'failed':
      return { bg: 'rgba(239,68,68,0.2)', fg: '#ef4444' };
    case 'offline':
      return { bg: 'rgba(255,255,255,0.08)', fg: 'rgba(255,255,255,0.3)' };
    case 'completed':
      return { bg: 'rgba(96,165,250,0.2)', fg: '#60a5fa' };
    default:
      return { bg: 'rgba(255,255,255,0.1)', fg: 'rgba(255,255,255,0.6)' };
  }
}

// ---------------------------------------------------------------------------
// AgentCard sub-component
// ---------------------------------------------------------------------------
interface AgentCardProps {
  agent: MascotAgent;
  onClick: () => void;
}

function AgentCard({ agent, onClick }: AgentCardProps) {
  const { t } = useTranslation();
  const colors = statusBadgeColors(agent.status);

  return (
    <div
      style={cardStyle}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
    >
      <div>
        <div style={cardNameStyle}>{agent.display_name}</div>
        <div style={cardMetaStyle}>
          {agent.role} &middot; {t(`resume.${agent.employment_type}`)}
          {agent.current_task ? ` — ${agent.current_task}` : ''}
        </div>
      </div>
      <span
        style={{
          ...badgeStyle,
          background: colors.bg,
          color: colors.fg,
        }}
      >
        {t(`status.${agent.status}`)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResumeDetail sub-component
// ---------------------------------------------------------------------------
interface ResumeDetailProps {
  resume: AgentResume;
  onBack: () => void;
}

function ResumeDetail({ resume, onBack }: ResumeDetailProps) {
  const { t } = useTranslation();
  const { agent, total_tasks_completed, total_tools_used, recent_events } = resume;
  const colors = statusBadgeColors(agent.status);

  return (
    <div>
      <div style={detailHeaderStyle}>
        <button type="button" style={backBtnStyle} onClick={onBack}>
          &larr;
        </button>
        <span style={detailNameStyle}>{agent.display_name}</span>
        <span
          style={{
            ...badgeStyle,
            background: colors.bg,
            color: colors.fg,
          }}
        >
          {t(`status.${agent.status}`)}
        </span>
      </div>

      <div style={statRowStyle}>
        <span style={statLabelStyle}>{t('resume.task')}</span>
        <span>{agent.current_task ?? '—'}</span>
      </div>
      <div style={statRowStyle}>
        <span style={statLabelStyle}>{agent.role}</span>
        <span>{t(`resume.${agent.employment_type}`)}</span>
      </div>
      <div style={statRowStyle}>
        <span style={statLabelStyle}>Tasks Completed</span>
        <span>{total_tasks_completed}</span>
      </div>
      <div style={statRowStyle}>
        <span style={statLabelStyle}>Tools Used</span>
        <span>{total_tools_used}</span>
      </div>

      <div style={detailSectionTitle}>Recent Events</div>
      {recent_events.length === 0 ? (
        <div style={emptyStyle}>—</div>
      ) : (
        recent_events.map((evt: ResumeEvent, idx: number) => (
          <div key={`${evt.ts}-${idx}`} style={eventRowStyle}>
            <div style={eventTypeStyle}>{evt.type}</div>
            <div style={eventSummaryStyle}>{evt.summary}</div>
            <div style={eventTsStyle}>{evt.ts}</div>
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResumeModal (main export)
// ---------------------------------------------------------------------------
export default function ResumeModal() {
  const { t } = useTranslation();
  const showResumeModal = useUiStore((s) => s.showResumeModal);
  const setShowResumeModal = useUiStore((s) => s.setShowResumeModal);
  const agentsByWorkspace = useAgentStore((s) => s.agentsByWorkspace);

  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [selectedResume, setSelectedResume] = useState<AgentResume | null>(null);
  const [loading, setLoading] = useState(false);

  // Toggle click-through on open/close
  useEffect(() => {
    if (showResumeModal) {
      toggleClickThrough(false).catch((err: unknown) => {
        useErrorStore.getState().push({
          source: 'ResumeModal',
          message: String(err),
          ts: new Date().toISOString(),
        });
      });
    }
    return () => {
      if (showResumeModal) {
        toggleClickThrough(true).catch((err: unknown) => {
          useErrorStore.getState().push({
            source: 'ResumeModal',
            message: String(err),
            ts: new Date().toISOString(),
          });
        });
      }
    };
  }, [showResumeModal]);

  const handleClose = useCallback(() => {
    setSelectedResume(null);
    setActiveTab('all');
    setShowResumeModal(false);
  }, [setShowResumeModal]);

  const handleSelectAgent = useCallback(async (agentId: string) => {
    setLoading(true);
    try {
      const resume = await getAgentResume(agentId);
      setSelectedResume(resume);
    } catch {
      // Error is already pushed by safeInvoke in commands.ts
    } finally {
      setLoading(false);
    }
  }, []);

  const handleBack = useCallback(() => {
    setSelectedResume(null);
  }, []);

  if (!showResumeModal) return null;

  // Build grouped + filtered agent list
  const groupedAgents: Array<{ workspaceId: string; agents: MascotAgent[] }> = [];
  for (const [wsId, wsMap] of agentsByWorkspace) {
    const agents: MascotAgent[] = [];
    for (const agent of wsMap.values()) {
      if (activeTab === 'all' || agent.employment_type === (activeTab as EmploymentType)) {
        agents.push(agent);
      }
    }
    if (agents.length > 0) {
      groupedAgents.push({ workspaceId: wsId, agents });
    }
  }

  const tabs: Array<{ key: TabFilter; label: string }> = [
    { key: 'all', label: t('resume.all') },
    { key: 'employee', label: t('resume.employee') },
    { key: 'contractor', label: t('resume.contractor') },
  ];

  return (
    <div style={backdropStyle} onClick={handleClose}>
      <div
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={headerStyle}>
          <h2 style={titleStyle}>{t('resume.title')}</h2>
          <button type="button" style={closeBtnStyle} onClick={handleClose}>
            &times;
          </button>
        </div>

        {/* Tabs -- only show in list view */}
        {selectedResume === null && (
          <div style={tabBarStyle}>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                style={{
                  ...tabBaseStyle,
                  ...(activeTab === tab.key ? tabActiveExtra : {}),
                }}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div style={bodyStyle}>
          {loading ? (
            <div style={emptyStyle}>...</div>
          ) : selectedResume !== null ? (
            <ResumeDetail resume={selectedResume} onBack={handleBack} />
          ) : groupedAgents.length === 0 ? (
            <div style={emptyStyle}>—</div>
          ) : (
            groupedAgents.map((group) => (
              <div key={group.workspaceId}>
                <div style={workspaceHeaderStyle}>{group.workspaceId}</div>
                {group.agents.map((agent) => (
                  <AgentCard
                    key={agent.agent_id}
                    agent={agent}
                    onClick={() => void handleSelectAgent(agent.agent_id)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
