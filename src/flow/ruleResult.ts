/** What checking one rule came to: still running, counted, or unable to run. Pure; puddle-run reads it too. */
export type RuleResult = { state: 'pending' } | { state: 'ok'; failures: number; total: number } | { state: 'error'; message: string };
