// How a group's card, frame and sockets are named on the canvas (see GroupNode.tsx).

/** The canvas id of a group's collapsed card, or its frame when open. */
export const groupCardId = (groupId: string) => `group:${groupId}`;
export const groupFrameId = (groupId: string) => `frame:${groupId}`;
/** The group a canvas id names, if it is a group's card or frame. */
export const groupIdOf = (flowId: string) => (flowId.startsWith('group:') || flowId.startsWith('frame:') ? flowId.slice(6) : undefined);

export const inHandle = (edgeId: string) => `in:${edgeId}`;
export const outHandle = (nodeId: string) => `out:${nodeId}`;
