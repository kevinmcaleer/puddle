import type { NodeStatus } from '../flow/status';
import { samePort, type Port } from '../model';

/** Where input i of `count` sits down a node's left edge: evenly spaced, a single one in the middle. */
export const portTop = (i: number, count: number) => `${Math.round((100 * (i + 1)) / (count + 1))}%`;

/** Whether the cause of a broken node arrives through this input: all of them, unless the error names some. */
export const portBroken = (status: NodeStatus, port: Port) => status.state === 'error' && (!status.ports || status.ports.some((p) => samePort(p, port)));
