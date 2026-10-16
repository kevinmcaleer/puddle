import type { NodeStatus } from '../flow/status';
import { samePort, type InputPort, type Port } from '../model';

/** Where input i of `count` sits down a node's left edge: evenly spaced, a single one in the middle. */
export const portTop = (i: number, count: number) => `${Math.round((100 * (i + 1)) / (count + 1))}%`;

/** Whether the cause of a broken node arrives through this input: all of them, unless the error names some. */
export const portBroken = (status: NodeStatus, port: Port) => status.state === 'error' && (!status.ports || status.ports.some((p) => samePort(p, port)));

/** What an input is called on its handle: "Left input", "Input 2". */
export const portName = (port: InputPort) => (/input/i.test(port.label) ? port.label : `${port.label} input`);

/** A node with many inputs grows so its handles keep their spacing. */
export const portsHeight = (count: number) => `calc(${count + 1} * 2 * var(--size-handle))`;
