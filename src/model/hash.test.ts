import { hashString, hashValue, stableStringify } from './hash';

describe('hashing', () => {
  it('ignores key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(hashValue({ b: 1, a: 2 })).toBe(hashValue({ a: 2, b: 1 }));
  });

  it('is stable and distinguishes small changes', () => {
    expect(hashString('')).toBe('cbf29ce484222325');
    expect(hashString('a')).toBe('af63dc4c8601ec8c');
    expect(hashValue([1, 2])).not.toBe(hashValue([2, 1]));
  });
});
