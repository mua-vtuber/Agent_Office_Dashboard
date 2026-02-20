# Agent Mascot - Hooks Integration & Auto-Launch Specification

## 1. 목적

Claude Code의 hooks 시스템과 Agent Mascot 앱을 연동한다.
에이전트가 시작되면 앱이 자동으로 실행되고, 이벤트를 실시간으로 수신한다.

## 2. 전체 흐름

```
┌─ Claude Code ──────────────────────────────────┐
│                                                │
│  에이전트 실행 → hook 발화                      │
│       │                                        │
│       ▼                                        │
│  forward-to-mascot.mjs                         │
│       │                                        │
│       ├─ stdin에서 hook payload 읽기            │
│       ├─ _meta 메타데이터 추가                  │
│       ├─ /health 체크                           │
│       │   ├─ 200 OK → POST /ingest            │
│       │   └─ 연결 실패 → 앱 spawn → 대기 → POST│
│       └─ POST 실패 → stderr 출력               │
│                                                │
└────────────────────────────────────────────────┘
```

## 3. Hook Forwarder 스크립트

### 3.1 파일 위치

```
scripts/hooks/forward-to-mascot.mjs
```

### 3.2 동작 상세

```javascript
#!/usr/bin/env node

// 1. stdin에서 hook payload 읽기
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = JSON.parse(Buffer.concat(chunks).toString());

// 2. 메타데이터 추가
const enriched = {
    ...raw,
    _meta: {
        workspace_id: raw._meta?.workspace_id ?? deriveWorkspaceId(),
        terminal_session_id: raw._meta?.terminal_session_id ?? process.env.TERM_SESSION_ID,
        collected_at: new Date().toISOString(),
        forwarder_version: '2.0.0',
    },
};

// 3. collector URL 결정 (환경변수 → 기본값)
const collectorUrl = process.env.MASCOT_COLLECTOR_URL ?? 'http://127.0.0.1:4820';

// 4. 앱 실행 여부 확인 + 자동 실행
await ensureAppRunning(collectorUrl);

// 5. POST /ingest
const response = await fetch(`${collectorUrl}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(enriched),
    signal: AbortSignal.timeout(5000),
});

if (!response.ok) {
    process.stderr.write(`[mascot-hook] ingest failed: ${response.status}\n`);
}
```

### 3.3 자동 실행 로직

```javascript
async function ensureAppRunning(collectorUrl) {
    // health check
    try {
        const res = await fetch(`${collectorUrl}/health`, {
            signal: AbortSignal.timeout(500),
        });
        if (res.ok) return; // 이미 실행 중
    } catch {
        // 실행 안 됨 → spawn
    }

    // 앱 경로 결정
    const appPath = process.env.MASCOT_APP_PATH ?? detectAppPath();
    if (!appPath) {
        process.stderr.write('[mascot-hook] app not found, cannot auto-launch\n');
        return;
    }

    // detached 프로세스로 실행
    const { execFile } = await import('node:child_process');
    const child = execFile(appPath, [], {
        detached: true,
        stdio: 'ignore',
    });
    child.unref();

    // 시작 대기 (최대 5초)
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
            const res = await fetch(`${collectorUrl}/health`, {
                signal: AbortSignal.timeout(500),
            });
            if (res.ok) return; // 시작 완료
        } catch {
            // 아직 시작 안 됨, 재시도
        }
    }

    process.stderr.write('[mascot-hook] app launch timeout\n');
}
```

### 3.4 앱 경로 탐지

```javascript
function detectAppPath() {
    const { platform } = process;
    const { existsSync } = await import('node:fs');

    const candidates = [];

    if (platform === 'win32') {
        candidates.push(
            `${process.env.LOCALAPPDATA}/Agent Mascot/agent-mascot.exe`,
            `${process.env.PROGRAMFILES}/Agent Mascot/agent-mascot.exe`,
        );
    } else if (platform === 'darwin') {
        candidates.push(
            '/Applications/Agent Mascot.app/Contents/MacOS/agent-mascot',
            `${process.env.HOME}/Applications/Agent Mascot.app/Contents/MacOS/agent-mascot`,
        );
    } else {
        candidates.push(
            '/usr/bin/agent-mascot',
            `${process.env.HOME}/.local/bin/agent-mascot`,
            '/usr/local/bin/agent-mascot',
        );
    }

    return candidates.find(p => existsSync(p)) ?? null;
}
```

### 3.5 workspace_id 추출

```javascript
function deriveWorkspaceId() {
    // 1. 환경변수에서
    if (process.env.CLAUDE_PROJECT_DIR) {
        return pathBasename(process.env.CLAUDE_PROJECT_DIR);
    }
    // 2. cwd에서
    return pathBasename(process.cwd());
}
```

## 4. Claude Code Hooks 설정

### 4.1 프로젝트 로컬 설정

`.claude/settings.local.json`:

```json
{
    "hooks": {
        "SubagentStart": [
            {
                "matcher": "",
                "hooks": [
                    {
                        "type": "command",
                        "command": "node /path/to/agent-mascot/scripts/hooks/forward-to-mascot.mjs"
                    }
                ]
            }
        ],
        "SubagentStop": [
            {
                "matcher": "",
                "hooks": [
                    {
                        "type": "command",
                        "command": "node /path/to/agent-mascot/scripts/hooks/forward-to-mascot.mjs"
                    }
                ]
            }
        ],
        "PreToolUse": [
            {
                "matcher": "",
                "hooks": [
                    {
                        "type": "command",
                        "command": "node /path/to/agent-mascot/scripts/hooks/forward-to-mascot.mjs"
                    }
                ]
            }
        ],
        "PostToolUse": [
            {
                "matcher": "",
                "hooks": [
                    {
                        "type": "command",
                        "command": "node /path/to/agent-mascot/scripts/hooks/forward-to-mascot.mjs"
                    }
                ]
            }
        ],
        "Notification": [
            {
                "matcher": "",
                "hooks": [
                    {
                        "type": "command",
                        "command": "node /path/to/agent-mascot/scripts/hooks/forward-to-mascot.mjs"
                    }
                ]
            }
        ],
        "Stop": [
            {
                "matcher": "",
                "hooks": [
                    {
                        "type": "command",
                        "command": "node /path/to/agent-mascot/scripts/hooks/forward-to-mascot.mjs"
                    }
                ]
            }
        ]
    }
}
```

### 4.2 WSL 환경 주의사항

WSL에서 Claude Code를 실행할 경우:
- 스크립트 경로는 **WSL 경로** 사용: `/mnt/f/hayoung/git/agent-mascot/scripts/...`
- Windows 경로 (`F:/hayoung/...`) 사용 금지 — WSL의 `node`가 경로를 이중 결합하여 실패

기존 프로젝트에서 발생했던 에러:
```
Error: Cannot find module '/mnt/f/hayoung/git/.../F:/hayoung/git/.../forward-to-aod.mjs'
```
이는 Windows 절대 경로가 WSL cwd와 결합되면서 발생한 문제.

### 4.3 글로벌 설정 (선택)

모든 프로젝트에서 mascot을 사용하려면 `~/.claude/settings.json`에 hooks를 등록한다.
프로젝트별 `.claude/settings.local.json`보다 우선순위가 낮으므로, 프로젝트별 오버라이드가 가능하다.

## 5. HTTP 엔드포인트

### 5.1 `GET /health`

앱 실행 여부 확인용.

- 응답: `200 OK`, body: `"ok"`
- 앱이 실행 중이 아니면 연결 거부 (TCP 레벨)

### 5.2 `POST /ingest`

hook 이벤트 수신.

요청:
```json
{
    "hook_type": "SubagentStart",
    "session_id": "...",
    "agent_name": "worker-01",
    "agent_type": "...",
    "team_name": "my-team",
    "prompt": "...",
    "_meta": {
        "workspace_id": "my-project",
        "terminal_session_id": "term_abc123",
        "collected_at": "2026-02-20T15:00:00.000Z",
        "forwarder_version": "2.0.0"
    }
}
```

응답:
- `200 OK`: 정상 처리
- `400 Bad Request`: JSON 파싱 실패 (에러 메시지 포함)
- `500 Internal Server Error`: 내부 처리 실패 (에러 메시지 포함)

### 5.3 처리 파이프라인

```
POST /ingest
  │
  ├─ 1. JSON 파싱 (실패 → 400 응답 + 에러 로그)
  ├─ 2. normalizer.normalize(payload) → NormalizedEvent
  ├─ 3. 핑거프린트 중복 검사 (중복 → 200 응답, skip)
  ├─ 4. events 테이블에 INSERT
  ├─ 5. 에이전트 미등록 시 자동 등록
  │     - employment_type: contractor (기본)
  │     - source: runtime_agent
  │     - avatar_seed: hash_seed(agent_id)
  ├─ 6. state_machine.transition(current, event) → next
  ├─ 7. agent_state 테이블 UPDATE
  ├─ 8. appearance.generate_appearance(agent_id, slot_counts)
  ├─ 9. Tauri 이벤트 emit:
  │     - 새 에이전트: "mascot://agent-appeared"
  │     - 상태 변경: "mascot://agent-update"
  │     - 퇴장: "mascot://agent-departed"
  └─ 10. 200 응답
```

## 6. Hook 이벤트 → 정규화 매핑

기존 `normalizer.ts`의 매핑을 계승한다:

| Hook 이벤트 | 정규화 타입 | 추출 데이터 |
|------------|------------|-------------|
| `SubagentStart` | `agent_started` | agent_name, team_name, prompt |
| `SubagentStop` | `agent_stopped` | agent_name, result |
| `PreToolUse` | `tool_started` | tool_name, tool_input |
| `PostToolUse` (성공) | `tool_succeeded` | tool_name, tool_result |
| `PostToolUse` (실패) | `tool_failed` | tool_name, error, exit_code |
| `Notification` | `notification` | message, level |
| `Stop` | `agent_stopped` | reason, summary |

### 6.1 팀 상호작용 시맨틱 추출

`PreToolUse`의 `tool_name` + `tool_input`에서 고수준 이벤트를 추출한다:

| tool_name | tool_input 조건 | 추출 이벤트 |
|-----------|---------------|-------------|
| `TaskCreate` | - | `task_created` |
| `TaskUpdate` | `status: "completed"` | `task_completed` |
| `TaskUpdate` | `status: "in_progress"` | `task_started` |
| `SendMessage` | - | (무시, 마스코트에서 불필요) |

### 6.2 Thinking 텍스트 추출

`PostToolUse` 또는 `Notification` 이벤트에 `thinking` 또는 `extended_thinking` 필드가 포함되어 있으면 추출하여 `thinking_text`로 저장한다.

## 7. 정규화 이벤트 스키마

기존 `event-schema.md`에서 계승. Rust normalizer가 hook payload를 변환한 결과물.

### 7.1 NormalizedEvent 구조

```rust
pub struct NormalizedEvent {
    pub id: String,                          // 전역 고유 ID (예: "evt_20260213_000001")
    pub version: String,                     // 스키마 버전 ("1.1")
    pub ts: String,                          // ISO-8601 UTC 타임스탬프
    pub event_type: EventType,               // 정규화 이벤트 타입 (아래 카탈로그)
    pub source: EventSource,                 // hook | synthetic
    pub workspace_id: String,                // 프로젝트/레포 단위 식별자
    pub terminal_session_id: String,         // 터미널 인스턴스 식별자
    pub run_id: Option<String>,              // 실행 단위 식별자 (같은 세션 내 복수 실행 구분)
    pub session_id: Option<String>,          // 상위 세션 식별자
    pub agent_id: String,                    // 이벤트 주체
    pub target_agent_id: Option<String>,     // 상대 주체 (메시지 수신자 등)
    pub task_id: Option<String>,             // 관련 작업
    pub severity: Severity,                  // debug | info | warn | error
    pub payload: serde_json::Value,          // 타입별 추가 데이터
    pub thinking_text: Option<String>,       // 추출된 thinking 텍스트
    pub raw: serde_json::Value,              // 원본 보존용
}
```

### 7.2 이벤트 타입 카탈로그 (v1.1)

에이전트 라이프사이클:
- `agent_started`, `agent_stopped`, `agent_blocked`, `agent_unblocked`

작업 흐름:
- `task_created`, `task_started`, `task_progress`, `task_completed`, `task_failed`

도구 실행:
- `tool_started`, `tool_succeeded`, `tool_failed`

시스템:
- `heartbeat`, `notification`, `schema_error`

### 7.3 식별자 매핑 규칙

- `agent_id` 구성:
  - 팀 에이전트: `{team_name}/{agent_name}`
  - 메인 리더: `{team_name}/leader`
- `session_id`는 내부 추적용. UI 표시명은 `agent_name` 사용
- `workspace_id` / `terminal_session_id` 누락 시 서버에서 `_meta` 필드로 보정

### 7.4 시맨틱 추출 우선순위

동일 의미 이벤트가 중복 감지되면:
1. `SubagentStart`/`SubagentStop` (확정 이벤트) — 최우선
2. `PreToolUse` 기반 추정 이벤트
3. `synthetic` 보완 이벤트

### 7.5 검증 규칙

공통 필수 필드:
- `id`, `version`, `ts`, `event_type`, `source`, `workspace_id`, `terminal_session_id`, `agent_id`
- `ts`는 UTC ISO-8601 형식

타입별 필수 필드:
- `task_*` → `task_id`
- `tool_*` → `payload.tool_name`
- `tool_failed` → `payload.tool_name`, `payload.exit_code`, `payload.error_message`

### 7.6 순서/중복 처리

- 수신 순서 ≠ 실제 발생 순서 가능
- 정렬 기준: `ts`, 동률 시 `id`
- 중복 이벤트: `id` 기준 upsert/skip
- hook 원본에 고유 ID가 없으므로 **핑거프린트**로 중복 제거:
  - `fingerprint = hash(session_id + tool_name + ts_bucket + payload_hash)`
  - `ts_bucket`: 1초 단위 절삭

### 7.7 호환성 전략

- minor 확장: 새 optional 필드 추가 (version 유지)
- major 변경: `version` 상승 + Rust normalizer에 버전별 변환기 추가
- WebView는 알 수 없는 필드를 무시

## 8. Hook 원본 페이로드 계약

Claude Code hooks가 전달하는 원본 필드 (provider 업데이트에 따라 변할 수 있음):

| Hook 이벤트 | 주요 필드 |
|-------------|----------|
| `SubagentStart` | `session_id`, `agent_name`, `agent_type`, `parent_session_id`, `team_name`, `prompt` |
| `SubagentStop` | `session_id`, `agent_name`, `agent_type`, `parent_session_id`, `team_name`, `result` |
| `PreToolUse` | `session_id`, `tool_name`, `tool_input` |
| `PostToolUse` | `session_id`, `tool_name`, `tool_input`, `tool_result`, `error` |
| `Notification` | `session_id`, `message`, `level` |
| `Stop` | `session_id`, `reason`, `summary` |

원본 구조가 변경될 수 있으므로, `raw` 필드에 원본을 보존하고 normalizer에서 버전별 변환기를 둔다.

## 9. 환경변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `MASCOT_COLLECTOR_URL` | ingest 서버 URL | `http://127.0.0.1:4820` |
| `MASCOT_APP_PATH` | 앱 실행 파일 경로 | 자동 탐지 |
| `CLAUDE_PROJECT_DIR` | Claude Code 프로젝트 디렉토리 | (Claude Code가 설정) |
| `TERM_SESSION_ID` | 터미널 세션 ID | (환경에 따라 다름) |

## 10. 에러 처리

| 상황 | 처리 |
|------|------|
| stdin 읽기 실패 | stderr 출력 + exit 1 |
| JSON 파싱 실패 | stderr 출력 + exit 1 |
| /health 연결 실패 + 앱 경로 없음 | stderr 출력 (auto-launch 불가) |
| /health 연결 실패 + 앱 spawn 성공 | 대기 후 POST |
| /health 연결 실패 + 앱 spawn 타임아웃 | stderr 출력 |
| POST /ingest 실패 | stderr 출력 (non-blocking) |
| POST /ingest 타임아웃 (5초) | stderr 출력 (non-blocking) |

**모든 에러는 stderr로 출력한다.** Claude Code가 hook의 stderr를 사용자에게 표시하므로, 이것이 사용자에게 에러를 알리는 경로다.

hook 스크립트 자체의 실패가 Claude Code의 동작을 차단하지 않아야 한다 (non-blocking hook).

## 11. 테스트 방법

### 9.1 수동 테스트

```bash
# 앱이 실행 중인 상태에서
echo '{"hook_type":"SubagentStart","session_id":"test","agent_name":"test-agent","team_name":"test-project","_meta":{"workspace_id":"test-project"}}' | node scripts/hooks/forward-to-mascot.mjs

# 앱이 실행 중이 아닌 상태에서 (auto-launch 테스트)
MASCOT_APP_PATH=/path/to/agent-mascot echo '{"hook_type":"SubagentStart",...}' | node scripts/hooks/forward-to-mascot.mjs
```

### 9.2 curl로 직접 테스트

```bash
# health check
curl http://127.0.0.1:4820/health

# ingest
curl -X POST http://127.0.0.1:4820/ingest \
  -H 'Content-Type: application/json' \
  -d '{"hook_type":"SubagentStart","session_id":"s1","agent_name":"worker-01","team_name":"my-project","_meta":{"workspace_id":"my-project","terminal_session_id":"t1","collected_at":"2026-02-20T15:00:00Z"}}'
```

## 12. 결정 로그

| 날짜 | 결정 | 이유 |
|------|------|------|
| 2026-02-20 | hook forwarder를 Node.js로 유지 | Claude Code hooks는 command를 실행하므로, 가장 범용적인 런타임 |
| 2026-02-20 | auto-launch를 forwarder에서 처리 | 별도 daemon 없이 hook 발화 시점에 앱을 띄움 |
| 2026-02-20 | collector URL을 환경변수로 설정 가능 | 하드코딩 금지 원칙 |
| 2026-02-20 | WSL 경로 문제 문서화 | 기존 프로젝트에서 발생한 실제 버그 |
