import { portBroken, portTop } from './ports';

describe('input ports on a node', () => {
  it('spaces inputs evenly down the left edge', () => {
    expect(portTop(0, 1)).toBe('50%');
    expect([portTop(0, 2), portTop(1, 2)]).toEqual(['33%', '67%']);
    expect([0, 1, 2].map((i) => portTop(i, 3))).toEqual(['25%', '50%', '75%']);
  });

  it('marks only the inputs a broken node blames, or all of them when it names none', () => {
    const right = { state: 'error' as const, message: 'x', ports: ['right' as const] };
    expect(portBroken(right, 'right')).toBe(true);
    expect(portBroken(right, 'left')).toBe(false);
    expect(portBroken({ state: 'error', message: 'x' }, 'left')).toBe(true);
    expect(portBroken({ state: 'error', message: 'x' }, 0)).toBe(true);
    expect(portBroken({ state: 'ok', columns: [] }, 0)).toBe(false);
  });
});
