use serde::{Deserialize, Serialize};

/// 에이전트 역할
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    Manager,
    Worker,
    Specialist,
    Unknown,
}

/// 고용 형태
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EmploymentType {
    Employee,
    Contractor,
}

/// 14개 에이전트 상태 (state-machine.md §2)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Offline,
    Appearing,
    Idle,
    Working,
    Thinking,
    PendingInput,
    Failed,
    Completed,
    Resting,
    Startled,
    Walking,
    Chatting,
    Returning,
    Disappearing,
}

/// 에이전트 상태 (state-machine.md §3)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentState {
    pub agent_id: String,
    pub status: AgentStatus,
    pub thinking_text: Option<String>,
    pub current_task: Option<String>,
    pub workspace_id: String,
    pub since: String,
    pub last_event_ts: String,
    pub session_id: Option<String>,
    pub peer_agent_id: Option<String>,
    pub home_x: f64,
}

/// 외형 프로필 (spine-spec.md §3.3)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceProfile {
    pub body_index: usize,
    pub hair_index: usize,
    pub outfit_index: usize,
    pub accessory_index: usize,
    pub face_index: usize,
    pub hair_hue: f64,
    pub outfit_hue: f64,
    pub skin_hue: f64,
    pub skin_lightness: f64,
}

/// Spine 스킨 슬롯 개수 (WebView에서 수신)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SlotCounts {
    pub body: usize,
    pub hair: usize,
    pub outfit: usize,
    pub accessory: usize,
    pub face: usize,
}

/// 마스코트 에이전트 (IPC 전달용 전체 정보)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MascotAgent {
    pub agent_id: String,
    pub display_name: String,
    pub role: AgentRole,
    pub employment_type: EmploymentType,
    pub workspace_id: String,
    pub status: AgentStatus,
    pub thinking_text: Option<String>,
    pub current_task: Option<String>,
    pub appearance: AppearanceProfile,
    pub last_active_ts: String,
}
