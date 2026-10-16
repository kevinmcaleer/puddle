import type { NodeType } from '../model';
import type { NodeKind } from '../ui';

/** The design system's node kind a node is drawn as: a Lookup combines two inputs, so it's styled as a Join. */
export const cardKind = (type: NodeType): NodeKind => (type === 'lookup' ? 'join' : type);
