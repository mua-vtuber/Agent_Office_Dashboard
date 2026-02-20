import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AgentAppearedPayload,
  AgentUpdatePayload,
  AgentDepartedPayload,
  ErrorPayload,
  SettingsChangedPayload,
} from '../types/ipc';

type EventCallback<T> = (payload: T) => void;

export async function onAgentAppeared(cb: EventCallback<AgentAppearedPayload>): Promise<UnlistenFn> {
  return listen<AgentAppearedPayload>('mascot://agent-appeared', (event) => cb(event.payload));
}

export async function onAgentUpdate(cb: EventCallback<AgentUpdatePayload>): Promise<UnlistenFn> {
  return listen<AgentUpdatePayload>('mascot://agent-update', (event) => cb(event.payload));
}

export async function onAgentDeparted(cb: EventCallback<AgentDepartedPayload>): Promise<UnlistenFn> {
  return listen<AgentDepartedPayload>('mascot://agent-departed', (event) => cb(event.payload));
}

export async function onError(cb: EventCallback<ErrorPayload>): Promise<UnlistenFn> {
  return listen<ErrorPayload>('mascot://error', (event) => cb(event.payload));
}

export async function onOpenResumeModal(cb: () => void): Promise<UnlistenFn> {
  return listen('mascot://open-resume-modal', () => cb());
}

export async function onSettingsChanged(cb: EventCallback<SettingsChangedPayload>): Promise<UnlistenFn> {
  return listen<SettingsChangedPayload>('mascot://settings-changed', (event) => cb(event.payload));
}
