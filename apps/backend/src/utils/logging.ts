export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  return { message: String(error) };
}

export function summarizeHookBody(body: Record<string, unknown>): Record<string, unknown> {
  return {
    event_name: typeof body.event_name === "string" ? body.event_name : undefined,
    hook_event: typeof body.hook_event === "string" ? body.hook_event : undefined,
    workspace_id: typeof body.workspace_id === "string" ? body.workspace_id : undefined,
    terminal_session_id: typeof body.terminal_session_id === "string" ? body.terminal_session_id : undefined,
    run_id: typeof body.run_id === "string" ? body.run_id : undefined,
    session_id: typeof body.session_id === "string" ? body.session_id : undefined,
    team_name: typeof body.team_name === "string" ? body.team_name : undefined,
    agent_name: typeof body.agent_name === "string" ? body.agent_name : undefined,
    tool_name: typeof body.tool_name === "string" ? body.tool_name : undefined,
    has_error: body.error !== undefined && body.error !== null
  };
}
