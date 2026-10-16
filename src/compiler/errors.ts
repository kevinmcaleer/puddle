import type { Port } from '../model';

/**
 * A flow that can't be turned into SQL. The message is for people; nodeId points the canvas at the cause,
 * and ports, when given, at the inputs whose wires carry it (a key column missing on the left, say).
 */
export class CompileError extends Error {
  constructor(
    message: string,
    readonly nodeId?: string,
    readonly stepId?: string,
    readonly ports?: Port[],
  ) {
    super(message);
    this.name = 'CompileError';
  }
}

/** A node with an input that has no wire in it yet. Not a mistake, just unfinished. */
export class UnwiredError extends CompileError {
  constructor(message: string, nodeId: string, port?: Port) {
    super(message, nodeId, undefined, port == null ? undefined : [port]);
    this.name = 'UnwiredError';
  }
}

/** A node that needs its inputs' columns (a Join) before they've been described. Try again once they are. */
export class PendingSchemaError extends CompileError {
  constructor(message: string, nodeId: string) {
    super(message, nodeId);
    this.name = 'PendingSchemaError';
  }
}
