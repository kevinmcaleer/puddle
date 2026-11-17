import { describe, expect, it } from 'vitest';
import { addNode, createProject, makeGroup, moveGroup, setGroupCollapsed, type Project } from '../model';
import { positionAfter } from './actions';

/** A source-like node at 80, then three Transforms spread to the right of it. */
function line(): Project {
  let p: Project = createProject('Placing');
  for (const x of [80, 376, 672, 968]) p = addNode(p, 'transform', { x, y: 80 });
  return p;
}
const ids = (p: Project) => p.nodes.map((n) => n.id);

describe('where a new node goes', () => {
  it('is one gap right of the node it follows, level with it', () => {
    const p = line();
    expect(positionAfter(p, [ids(p)[3]!])).toEqual({ x: 968 + 296, y: 80 });
  });

  // Regression (#273): after the last node of a closed group, the new node went where that hidden node is,
  // far to the right of the card the canvas draws.
  it('is one gap right of a closed group’s card when the node it follows is hidden in it', () => {
    let p = line();
    const [, a, b, c] = ids(p);
    p = makeGroup(p, [a!, b!, c!]);
    const group = p.groups[0]!;
    expect(group.collapsed).toBe(true);
    expect(positionAfter(p, [c!])).toEqual({ x: group.position.x + 296, y: group.position.y });
    // The card moved: the new node follows the card.
    p = moveGroup(p, group.id, { x: 500, y: 300 });
    expect(positionAfter(p, [c!])).toEqual({ x: 796, y: 300 });
    // Open, the nodes are what is drawn, so it follows the node again.
    p = setGroupCollapsed(p, group.id, false);
    const last = p.nodes.find((n) => n.id === c)!;
    expect(positionAfter(p, [c!])).toEqual({ x: last.position.x + 296, y: last.position.y });
  });

  it('with nothing to follow, goes right of everything drawn, counting a closed group as its card', () => {
    let p = line();
    const [, a, b, c] = ids(p);
    expect(positionAfter(p, [])).toEqual({ x: 968 + 296, y: 80 });
    p = makeGroup(p, [a!, b!, c!]);
    expect(positionAfter(p, [])).toEqual({ x: p.groups[0]!.position.x + 296, y: 80 });
  });
});
