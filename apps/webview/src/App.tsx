import { useEffect, useRef, useState } from 'react';
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
  onSettingsChanged,
} from './tauri/events';
import { MascotStage, CharacterManager } from './pixi';
import ErrorToast from './components/ErrorToast';
import ErrorOverlay from './components/ErrorOverlay';
import ResumeModal from './components/ResumeModal';

function App() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<MascotStage | null>(null);
  const managerRef = useRef<CharacterManager | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);

  useEffect(() => {
    let destroyed = false;

    async function initialize(): Promise<Array<() => void>> {
      // 1. DisplayConfig 로드
      const displayConfig = await getDisplayConfig();
      if (destroyed) return [];

      // 2. MascotStage 생성 및 초기화
      const container = canvasRef.current;
      if (!container) {
        throw new Error('Canvas container ref is not mounted');
      }

      const stage = new MascotStage();
      await stage.init(container, displayConfig);
      if (destroyed) {
        stage.destroy();
        return [];
      }
      stageRef.current = stage;

      // UI store에 DisplayConfig 저장
      useUiStore.getState().setDisplayConfig(displayConfig);

      // 3. CharacterManager 생성 및 Spine 에셋 로드
      const manager = new CharacterManager(stage, displayConfig);
      try {
        await manager.loadSpineAsset();
      } catch (err) {
        // Spine 로드 실패 → fatal error
        stage.destroy();
        stageRef.current = null;
        throw new Error(`Spine 에셋 로드 실패: ${String(err)}`);
      }
      if (destroyed) {
        manager.destroy();
        stage.destroy();
        stageRef.current = null;
        return [];
      }
      managerRef.current = manager;

      // 4. 기존 에이전트 복원 — store + CharacterManager 동시 추가
      const existingAgents = await getAllAgents();
      if (!destroyed) {
        for (const agent of existingAgents) {
          useAgentStore.getState().addAgent(agent);
          manager.addAgent(agent);
        }
      }

      // 5. Tauri 이벤트 리스너 등록
      const unlisteners = await Promise.all([
        onAgentAppeared((p) => {
          if (destroyed) return;
          const agent = {
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
          };
          useAgentStore.getState().addAgent(agent);
          manager.addAgent(agent);
        }),

        onAgentUpdate((p) => {
          if (destroyed) return;
          useAgentStore.getState().updateStatus(p.agent_id, p.status, {
            thinking_text: p.thinking_text,
            current_task: p.current_task,
          });
          manager.updateAgent(p);
        }),

        onAgentDeparted((p) => {
          if (destroyed) return;
          useAgentStore.getState().removeAgent(p.agent_id);
          manager.removeAgent(p.agent_id);
        }),

        onError((p) => {
          if (destroyed) return;
          useErrorStore.getState().push(p);
        }),

        onOpenResumeModal(() => {
          if (destroyed) return;
          useUiStore.getState().setShowResumeModal(true);
        }),

        onSettingsChanged(async () => {
          if (destroyed) return;
          try {
            const newConfig = await getDisplayConfig();
            if (destroyed) return;
            useUiStore.getState().setDisplayConfig(newConfig);
            stage.updateDisplayConfig(newConfig);
            manager.updateDisplayConfig(newConfig);
          } catch {
            // getDisplayConfig already pushes to error-store via safeInvoke
          }
        }),
      ]);

      return unlisteners;
    }

    let unlistenersPromise: Promise<Array<() => void>> | null = null;

    unlistenersPromise = initialize().catch((err) => {
      if (!destroyed) {
        setFatalError(String(err));
      }
      return [];
    });

    // 6. 클린업
    return () => {
      destroyed = true;

      // CharacterManager 정리
      if (managerRef.current) {
        managerRef.current.destroy();
        managerRef.current = null;
      }

      // MascotStage 정리
      if (stageRef.current) {
        stageRef.current.destroy();
        stageRef.current = null;
      }

      // 이벤트 리스너 해제
      if (unlistenersPromise) {
        void unlistenersPromise.then((fns) => fns.forEach((fn) => fn()));
      }
    };
  }, []);

  if (fatalError) {
    return <ErrorOverlay message={fatalError} />;
  }

  return (
    <div style={{ width: '100%', height: '100%', background: 'transparent' }}>
      <div ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      <ErrorToast />
      <ResumeModal />
    </div>
  );
}

export default App;
