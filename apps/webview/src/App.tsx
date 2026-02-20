import { useEffect } from 'react';
import { useAgentStore } from './stores/agent-store';
import { useErrorStore } from './stores/error-store';
import { useUiStore } from './stores/ui-store';
import { getAllAgents, getDisplayConfig } from './tauri/commands';
import {
  onAgentAppeared,
  onAgentUpdate,
  onAgentDeparted,
  onError,
  onOpenResumeModal,
} from './tauri/events';

function App() {
  const addAgent = useAgentStore((s) => s.addAgent);
  const updateStatus = useAgentStore((s) => s.updateStatus);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const pushError = useErrorStore((s) => s.push);
  const setDisplayConfig = useUiStore((s) => s.setDisplayConfig);
  const setShowResumeModal = useUiStore((s) => s.setShowResumeModal);

  useEffect(() => {
    // 초기화: 기존 에이전트 복원 + 설정 로드
    getAllAgents()
      .then((agents) => agents.forEach(addAgent))
      .catch(() => {});

    getDisplayConfig()
      .then(setDisplayConfig)
      .catch(() => {});

    // 이벤트 리스너 등록
    const unlisteners = Promise.all([
      onAgentAppeared((p) => {
        addAgent({
          agent_id: p.agent_id,
          display_name: p.display_name,
          role: p.role,
          employment_type: p.employment_type,
          workspace_id: p.workspace_id,
          status: p.status,
          thinking_text: null,
          current_task: null,
          appearance: p.appearance,
          last_active_ts: p.ts,
        });
      }),
      onAgentUpdate((p) => {
        updateStatus(p.agent_id, p.status, {
          thinking_text: p.thinking_text,
          current_task: p.current_task,
        });
      }),
      onAgentDeparted((p) => {
        removeAgent(p.agent_id);
      }),
      onError((p) => {
        pushError(p);
      }),
      onOpenResumeModal(() => {
        setShowResumeModal(true);
      }),
    ]);

    return () => {
      unlisteners.then((fns) => fns.forEach((fn) => fn()));
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', background: 'transparent' }}>
      {/* PixiJS 캔버스가 여기에 마운트될 예정 */}
      {/* ErrorToast, ResumeModal 등 React 오버레이 컴포넌트 추가 예정 */}
    </div>
  );
}

export default App;
