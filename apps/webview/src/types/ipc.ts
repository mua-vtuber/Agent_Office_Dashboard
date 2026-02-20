import type { AgentStatus, AppearanceProfile, MascotAgent } from './agent';

// Rust -> WebView 이벤트 페이로드
export interface AgentAppearedPayload {
  agent_id: string;
  display_name: string;
  role: 'manager' | 'worker' | 'specialist' | 'unknown';
  employment_type: 'employee' | 'contractor';
  workspace_id: string;
  status: AgentStatus;
  appearance: AppearanceProfile;
  ts: string;
}

export interface AgentUpdatePayload {
  agent_id: string;
  status: AgentStatus;
  prev_status: AgentStatus;
  thinking_text: string | null;
  current_task: string | null;
  workspace_id: string;
  peer_agent_id: string | null;
  chat_message: string | null;
  ts: string;
}

export interface AgentDepartedPayload {
  agent_id: string;
  ts: string;
}

export interface ErrorPayload {
  source: string;
  message: string;
  ts: string;
}

export interface SettingsChangedPayload {
  key: string;
  value: unknown;
}

export interface DisplayConfig {
  max_bubble_chars: number;
  bubble_fade_ms: number;
  character_spacing_px: number;
  group_spacing_px: number;
  activity_zone_height_px: number;
  taskbar_offset_px: number;
  idle_sway_px: number;
}

export interface AgentResume {
  agent: MascotAgent;
  recent_events: ResumeEvent[];
  total_tasks_completed: number;
  total_tools_used: number;
  first_seen_ts: string;
}

export interface ResumeEvent {
  type: string;
  summary: string;
  ts: string;
}
