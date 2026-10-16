import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Activity } from '../engine';
import { Button, formatDuration } from '../ui';
import { useEngineStore } from './engine';

/** Queries quicker than this never show the Stop control, so it doesn't flicker on every edit. */
export const STOP_AFTER_MS = 800;

/**
 * What DuckDB is doing when it takes more than a moment, how long it has taken, and Stop. Stop cancels the running
 * query in DuckDB and drops the queued ones; whatever was stopped says so and offers Run again.
 */
export function ActivityControl() {
  const engine = useEngineStore((s) => s.engine);
  const subscribe = useCallback((fn: () => void) => engine?.onActivity(fn) ?? (() => undefined), [engine]);
  const activity: Activity | null = useSyncExternalStore(subscribe, () => engine?.activity ?? null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!activity) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [activity]);

  if (!engine || !activity) return null;
  const elapsed = now - activity.startedAt;
  if (elapsed < STOP_AFTER_MS) return null;
  return (
    <span className="flex items-center gap-2" data-testid="activity">
      <span>
        {activity.label} · {formatDuration(elapsed)}
      </span>
      <Button size="sm" variant="secondary" icon="cross" onClick={() => engine.stop()}>
        Stop
      </Button>
    </span>
  );
}
