export type AgentStatus =
  | 'offline'
  | 'appearing'
  | 'idle'
  | 'working'
  | 'thinking'
  | 'pending_input'
  | 'failed'
  | 'completed'
  | 'resting'
  | 'startled'
  | 'walking'
  | 'chatting'
  | 'returning'
  | 'disappearing';

export type AgentRole = 'manager' | 'worker' | 'specialist' | 'unknown';
export type EmploymentType = 'employee' | 'contractor';

export interface AppearanceProfile {
  body_index: number;
  hair_index: number;
  outfit_index: number;
  accessory_index: number;
  face_index: number;
  hair_hue: number;
  outfit_hue: number;
  skin_hue: number;
  skin_lightness: number;
}

export interface MascotAgent {
  agent_id: string;
  display_name: string;
  role: AgentRole;
  employment_type: EmploymentType;
  workspace_id: string;
  status: AgentStatus;
  thinking_text: string | null;
  current_task: string | null;
  appearance: AppearanceProfile;
  last_active_ts: string;
}

export interface SlotCounts {
  body: number;
  hair: number;
  outfit: number;
  accessory: number;
  face: number;
}
