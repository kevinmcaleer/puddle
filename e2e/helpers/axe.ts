import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** The WCAG 2.2 A and AA rules (axe tags each rule with the success criteria it checks). */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Run axe over the page as it is now and fail on any serious or critical issue, listing each one with the elements
 * it found it on, so a failure in CI says what to fix without the trace.
 */
export async function expectAccessible(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `  ${n.target.join(' ')}: ${n.failureSummary?.replace(/\n/g, ' ')}`).join('\n')}`);
  expect.soft(report, `axe found serious issues on ${screen}`).toEqual([]);
}
