import { useEffect, useState } from 'react';
import { useEngineStore } from '../app/engine';
import { CompileError, upstreamKey } from '../compiler';
import { toEngineError } from '../engine';
import { schemaCacheFor, useFlowStore } from '../flow/status';
import { inputEdges, type ColumnSchema, type Project } from '../model';

const NONE: ColumnSchema[] = [];

/** The columns arriving at step k of a node: the node's input for the first step, else the schema after step k-1. */
export function useStepColumns(project: Project, nodeId: string, stepIndex: number): ColumnSchema[] {
  const engine = useEngineStore((s) => s.engine);
  const inputId = inputEdges(project, nodeId)[0]?.from.nodeId ?? '';
  const inputStatus = useFlowStore((s) => s.nodes[inputId]?.status);
  const key = stepIndex > 0 ? upstreamKey(project, { nodeId, stepIndex: stepIndex - 1 }) : '';
  const [after, setAfter] = useState<{ key: string; columns: ColumnSchema[] } | null>(null);
  useEffect(() => {
    if (!engine || !key) return;
    let live = true;
    schemaCacheFor(engine)
      .get(project, { nodeId, stepIndex: stepIndex - 1 })
      .then(
        (columns) => live && setAfter({ key, columns }),
        () => live && setAfter({ key, columns: NONE }),
      );
    return () => {
      live = false;
    };
    // `key` captures everything about the project that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, key]);
  if (stepIndex === 0) return inputStatus?.state === 'ok' ? inputStatus.columns : NONE;
  return after?.key === key ? after.columns : NONE;
}

/**
 * Which step breaks a broken node, and why: each step's schema is checked in order (cached), and the first
 * that fails gets the message. Returns {} while the node is fine.
 */
export function useStepErrors(project: Project, nodeId: string, broken: boolean, stepCount: number): Record<number, string> {
  const engine = useEngineStore((s) => s.engine);
  const key = broken ? upstreamKey(project, { nodeId }) : '';
  const [found, setFound] = useState<{ key: string; errors: Record<number, string> } | null>(null);
  useEffect(() => {
    if (!engine || !key) return;
    let live = true;
    void (async () => {
      const cache = schemaCacheFor(engine);
      for (let k = 0; k < stepCount; k++) {
        try {
          await cache.get(project, { nodeId, stepIndex: k });
        } catch (e) {
          const message = e instanceof CompileError ? e.message : toEngineError(e).message;
          if (live) setFound({ key, errors: { [k]: message } });
          return;
        }
      }
      if (live) setFound({ key, errors: {} });
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, key, stepCount]);
  return key && found?.key === key ? found.errors : {};
}
