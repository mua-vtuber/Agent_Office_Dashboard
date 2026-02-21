import type { AgentStatus } from '../types/agent';

/** AgentStatus → Spine animation name mapping */
export const STATUS_TO_ANIMATION: Record<AgentStatus, string> = {
  offline: '',
  appearing: 'appear',
  idle: 'idle',
  working: 'working',
  thinking: 'thinking',
  pending_input: 'thinking',
  failed: 'failed',
  completed: 'celebrate',
  resting: 'resting',
  startled: 'startled',
  walking: 'walking',
  chatting: 'chatting',
  returning: 'walking',
  disappearing: 'disappear',
};

/** Looping animations */
export const LOOPING_ANIMATIONS = new Set([
  'idle', 'working', 'thinking', 'resting', 'chatting', 'walking', 'grabbed',
]);

/** Animation mix (blend) times in seconds. Key: "from/to" */
export const ANIMATION_MIX_TIMES: Record<string, number> = {
  'idle/working': 0.2,
  'working/idle': 0.2,
  'idle/thinking': 0.3,
  'thinking/working': 0.2,
  'working/failed': 0.1,
  'idle/resting': 0.5,
  'resting/startled': 0,
  'startled/working': 0.2,
  'startled/idle': 0.2,
  'idle/walking': 0.2,
  'walking/chatting': 0.2,
  'chatting/walking': 0.2,
  'walking/idle': 0.2,
  // 드래그 전환
  'grabbed/falling': 0.1,
  'falling/landing': 0,
  'landing/idle': 0.2,
};

/** Default mix time for unmapped combinations */
export const DEFAULT_MIX_TIME = 0.2;

/** Z-index constants */
export const Z_INDEX = {
  BEHIND: 0,
  NORMAL: 10,
  BUBBLE: 20,
  LABEL: 25,
  DRAGGED: 30,
} as const;

/** One-shot animations that need synthetic event reporting to Rust */
export const SYNTHETIC_ANIMATION_EVENTS: Partial<Record<string, string>> = {
  appear: 'appear',
  disappear: 'disappear',
  celebrate: 'celebrate',
  startled: 'startled',
};

/** Per-status speech bubble visibility */
export const STATUS_BUBBLE_VISIBILITY: Record<AgentStatus, boolean> = {
  offline: false,
  appearing: false,
  idle: false,
  working: true,
  thinking: true,
  pending_input: true,
  failed: true,
  completed: true,
  resting: true,
  startled: true,
  walking: false,
  chatting: true,
  returning: false,
  disappearing: false,
};
