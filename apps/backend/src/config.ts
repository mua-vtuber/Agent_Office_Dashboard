export const config = {
  port: Number(process.env.PORT ?? 4800),
  host: process.env.HOST ?? "0.0.0.0",
  dbPath: process.env.DB_PATH ?? "data/dashboard.db",
  defaultWorkspace: process.env.DEFAULT_WORKSPACE ?? "default-workspace",
  defaultTerminalSession: process.env.DEFAULT_TERMINAL_SESSION ?? "default-terminal",
  defaultRunId: process.env.DEFAULT_RUN_ID ?? "default-run"
};
