import { useEffect, useState } from "react";
import { useEventStore } from "../stores/event-store";

export function DashboardPage(): JSX.Element {
  const events = useEventStore((s) => s.events);
  const setAll = useEventStore((s) => s.setAll);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const res = await fetch("http://127.0.0.1:4800/api/events");
        const json = (await res.json()) as { events?: unknown[] };
        if (mounted && Array.isArray(json.events)) {
          setAll(json.events);
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "failed to load events");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [setAll]);

  return (
    <section>
      <h2>Dashboard</h2>
      <p>실시간 이벤트 로그</p>
      {error ? <p className="error">{error}</p> : null}
      <pre className="panel">{JSON.stringify(events.slice(0, 20), null, 2)}</pre>
    </section>
  );
}
