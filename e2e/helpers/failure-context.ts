import { readFileSync } from 'node:fs';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * Prints what the page showed when a test failed (Playwright's error context: the page as an accessibility tree)
 * into the run's output. CI turns it on with E2E_BROWSER_LOGS, so a failure in a browser that can't be run locally
 * can be read from the job log without downloading the report.
 */
export default class FailureContext implements Reporter {
  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === 'passed' || result.status === 'skipped') return;
    const context = result.attachments.find((a) => a.name === 'error-context' && a.path);
    let text = '';
    try {
      text = readFileSync(context!.path!, 'utf8');
    } catch {
      return;
    }
    const lines = text.split('\n');
    const shown = lines.slice(0, 200).join('\n') + (lines.length > 200 ? `\n… ${lines.length - 200} more lines` : '');
    console.log(`\n--- The page when "${test.titlePath().slice(1).join(' › ')}" failed ---\n${shown}\n--- end ---\n`);
  }
}
