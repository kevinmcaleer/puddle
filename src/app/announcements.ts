import { useEffect, useRef } from 'react';
import { useFlowStore } from '../flow/status';
import { useProjectStore } from '../model';
import { announce } from '../ui';
import { useEngineStore } from './engine';
import { useSession } from './session';
import { STOP_AFTER_MS } from './ActivityControl';

/** Words for a node that has just broken: its name and what's wrong, in the error's own plain words. */
export const brokeText = (name: string, message: string) => `${name} is broken: ${message}`;

/** Words for a query that is taking a while: what it is, and where Stop is. */
export const slowText = (label: string) => `Still working: ${label}. Stop is in the status bar.`;

/**
 * Tell screen readers what happens without them asking: a node breaking (at once), the canvas notice, and a query
 * that runs past the moment the Stop control appears (politely, once per query). Row counts and rule results are read from the status
 * strip, which is a live region of its own.
 */
export function useAnnouncements() {
  // Errors already told, by node id, so each break is said once (and again only after it was mended).
  const told = useRef(new Map<string, string>());
  useEffect(
    () =>
      useFlowStore.subscribe((s) => {
        const project = useProjectStore.getState().history.present;
        for (const [id, entry] of Object.entries(s.nodes)) {
          const status = entry.status;
          if (status.state !== 'error' || status.stopped) {
            told.current.delete(id);
            continue;
          }
          if (told.current.get(id) === status.message) continue;
          told.current.set(id, status.message);
          const node = project.nodes.find((n) => n.id === id);
          if (node) announce(brokeText(node.name, status.message), 'assertive');
        }
      }),
    [],
  );

  // The canvas notice (a wire refused, a file that couldn't be read, an export done) is drawn as a new banner each
  // time, which screen readers don't all notice: it is said here too.
  useEffect(
    () =>
      useSession.subscribe((s, before) => {
        if (s.notice && s.notice !== before.notice) announce(s.notice.text, s.notice.tone === 'fail' ? 'assertive' : 'polite');
      }),
    [],
  );

  const engine = useEngineStore((s) => s.engine);
  useEffect(() => {
    if (!engine) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: unknown = null;
    const off = engine.onActivity((a) => {
      if (a === current) return;
      current = a;
      clearTimeout(timer);
      if (a) timer = setTimeout(() => announce(slowText(a.label)), Math.max(0, a.startedAt + STOP_AFTER_MS - Date.now()));
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [engine]);
}
