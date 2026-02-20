use serde::{Deserialize, Serialize};

/// 정규화 이벤트 타입 카탈로그 (hooks-integration.md §7.2)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    // 에이전트 라이프사이클
    AgentStarted,
    AgentStopped,
    AgentBlocked,
    AgentUnblocked,
    // 작업 흐름
    TaskCreated,
    TaskStarted,
    TaskProgress,
    TaskCompleted,
    TaskFailed,
    // 도구 실행
    ToolStarted,
    ToolSucceeded,
    ToolFailed,
    // 확장 사고
    ThinkingUpdated,
    // 시스템
    Heartbeat,
    Notification,
    SchemaError,
    // 상호작용 (synthetic)
    MessageSent,
    MessageReceived,
    // 애니메이션 완료 (synthetic from WebView)
    AppearDone,
    DisappearDone,
    StartledDone,
    ArriveAtPeer,
    ArriveAtHome,
    MessageDone,
}

/// 이벤트 소스
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum EventSource {
    Hook,
    Synthetic,
}

/// 심각도
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Debug,
    Info,
    Warn,
    Error,
}

/// 정규화된 이벤트 (hooks-integration.md §7.1)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedEvent {
    pub id: String,
    pub version: String,
    pub ts: String,
    pub event_type: EventType,
    pub source: EventSource,
    pub workspace_id: String,
    pub terminal_session_id: String,
    pub run_id: Option<String>,
    pub session_id: Option<String>,
    pub agent_id: String,
    pub target_agent_id: Option<String>,
    pub task_id: Option<String>,
    pub severity: Severity,
    pub payload: serde_json::Value,
    pub thinking_text: Option<String>,
    pub raw: serde_json::Value,
}
