declare module "better-sqlite3" {
  type Statement = {
    run: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
    get: (...args: unknown[]) => unknown;
  };

  type DatabaseInstance = {
    pragma: (sql: string) => void;
    exec: (sql: string) => void;
    prepare: (sql: string) => Statement;
  };

  interface DatabaseConstructor {
    new (filename: string): DatabaseInstance;
  }

  const Database: DatabaseConstructor;
  export default Database;
}

declare module "ws" {
  type WebSocketLike = {
    readyState: number;
    send: (payload: string) => void;
  };

  export class WebSocketServer {
    clients: Set<WebSocketLike>;
    constructor(options: { noServer: boolean });
    on(event: "connection", cb: (socket: unknown) => void): void;
    handleUpgrade(
      request: unknown,
      socket: unknown,
      head: unknown,
      cb: (socket: unknown) => void
    ): void;
    emit(event: "connection", socket: unknown, request: unknown): void;
  }
}
