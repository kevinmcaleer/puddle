import { describe, expect, it } from 'vitest';
import { nextRun, scheduleProblem } from './schedule';

describe('runner schedules', () => {
  it('reads five-field cron and says what is wrong with anything else', () => {
    expect(scheduleProblem('0 3 * * *')).toBeUndefined();
    expect(scheduleProblem('*/15 * * * 1-5')).toBeUndefined();
    expect(scheduleProblem('')).toBe('is empty');
    expect(scheduleProblem('every day')).toMatch(/isn’t cron syntax/);
    expect(scheduleProblem('99 3 * * *')).toMatch(/isn’t cron syntax/);
  });

  it('knows when a schedule fires next', () => {
    const from = new Date('2026-10-17T14:30:00Z');
    expect(nextRun('0 3 * * *', from, 'UTC')?.toISOString()).toBe('2026-10-18T03:00:00.000Z');
    expect(nextRun('*/15 * * * *', from, 'UTC')?.toISOString()).toBe('2026-10-17T14:45:00.000Z');
    expect(nextRun('nope', from)).toBeUndefined();
  });
});
