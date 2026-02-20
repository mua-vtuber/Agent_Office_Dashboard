#!/usr/bin/env node

/**
 * Claude Code hook forwarder -> Agent Mascot
 * stdin에서 hook payload를 받아 Agent Mascot HTTP 서버로 전달.
 * 앱이 실행 중이 아니면 자동 실행을 시도한다.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { basename } from 'node:path';

const COLLECTOR_URL = process.env.MASCOT_COLLECTOR_URL ?? 'http://127.0.0.1:4820';
const HEALTH_TIMEOUT_MS = 500;
const INGEST_TIMEOUT_MS = 5000;
const LAUNCH_WAIT_MAX_MS = 5000;
const LAUNCH_POLL_INTERVAL_MS = 500;

async function main() {
  // 1. stdin에서 payload 읽기
  let raw;
  try {
    const input = readFileSync(0, 'utf-8');
    raw = JSON.parse(input);
  } catch (err) {
    process.stderr.write(`[mascot-hook] stdin parse error: ${err.message}\n`);
    process.exit(1);
  }

  // 2. 메타데이터 추가
  const enriched = {
    ...raw,
    _meta: {
      workspace_id: raw._meta?.workspace_id ?? deriveWorkspaceId(),
      terminal_session_id:
        raw._meta?.terminal_session_id ?? process.env.TERM_SESSION_ID ?? 'unknown',
      collected_at: new Date().toISOString(),
      forwarder_version: '2.0.0',
    },
  };

  // 3. 앱 실행 확인 + 자동 실행
  await ensureAppRunning();

  // 4. POST /ingest
  try {
    const res = await fetch(`${COLLECTOR_URL}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(enriched),
      signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      process.stderr.write(`[mascot-hook] ingest failed: ${res.status}\n`);
    }
  } catch (err) {
    process.stderr.write(`[mascot-hook] ingest error: ${err.message}\n`);
  }
}

function deriveWorkspaceId() {
  if (process.env.CLAUDE_PROJECT_DIR) {
    return basename(process.env.CLAUDE_PROJECT_DIR);
  }
  return basename(process.cwd());
}

async function ensureAppRunning() {
  try {
    const res = await fetch(`${COLLECTOR_URL}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (res.ok) return;
  } catch {
    // 앱 미실행
  }

  const appPath = process.env.MASCOT_APP_PATH ?? detectAppPath();
  if (!appPath) {
    process.stderr.write('[mascot-hook] app not found, cannot auto-launch\n');
    return;
  }

  try {
    const child = execFile(appPath, [], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (err) {
    process.stderr.write(`[mascot-hook] launch error: ${err.message}\n`);
    return;
  }

  const maxAttempts = LAUNCH_WAIT_MAX_MS / LAUNCH_POLL_INTERVAL_MS;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, LAUNCH_POLL_INTERVAL_MS));
    try {
      const res = await fetch(`${COLLECTOR_URL}/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (res.ok) return;
    } catch {
      // 아직 시작 안 됨
    }
  }

  process.stderr.write('[mascot-hook] app launch timeout\n');
}

function detectAppPath() {
  const { platform } = process;
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

  return candidates.find((p) => existsSync(p)) ?? null;
}

main();
