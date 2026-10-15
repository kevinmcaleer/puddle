/** A flow that can't be turned into SQL. The message is for people; nodeId points the canvas at the cause. */
export class CompileError extends Error {
  constructor(
    message: string,
    readonly nodeId?: string,
    readonly stepId?: string,
  ) {
    super(message);
    this.name = 'CompileError';
  }
}
