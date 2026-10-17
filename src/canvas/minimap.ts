/** A node's place and size in flow coordinates. */
export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Whether any node lies partly outside the visible canvas: the minimap is only worth its corner then. The viewport
 * is React Flow's transform (where flow point 0,0 is on screen, and the zoom), the size is the canvas element's.
 */
export function anyNodeOffscreen(nodes: NodeBox[], viewport: { x: number; y: number; zoom: number }, size: { width: number; height: number }): boolean {
  if (size.width <= 0 || size.height <= 0) return false;
  return nodes.some((n) => {
    const left = n.x * viewport.zoom + viewport.x;
    const top = n.y * viewport.zoom + viewport.y;
    const right = left + n.width * viewport.zoom;
    const bottom = top + n.height * viewport.zoom;
    return left < 0 || top < 0 || right > size.width || bottom > size.height;
  });
}
