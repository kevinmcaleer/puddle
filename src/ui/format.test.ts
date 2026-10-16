import { formatBytes } from './format';

describe('formatBytes', () => {
  it('writes sizes in binary units', () => {
    expect([0, 512, 4300, 5_314_560, 3.1 * 2 ** 30].map(formatBytes)).toEqual(['0 B', '512 B', '4.2 KB', '5.1 MB', '3.1 GB']);
    expect(formatBytes(1024)).toBe('1 KB');
  });
});
