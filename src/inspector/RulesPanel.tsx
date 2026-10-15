import { useState } from 'react';
import { useSession } from '../app/session';
import { useRuleStore, type RuleResult } from '../flow/rules';
import { useNodeStatus } from '../flow/status';
import { addRule, removeRule, updateRule, useProjectStore, type GraphNode, type Rule } from '../model';
import { newRule, ruleErrors, ruleForm, ruleForms, ruleLabel, showFailing } from '../rules';
import { FormFields } from '../steps/StepForm';
import { Button, Field, Menu, RuleRow, Section, Select, Switch } from '../ui';

const apply = (edit: Parameters<ReturnType<typeof useProjectStore.getState>['apply']>[0]) => useProjectStore.getState().apply(edit);
const NONE: Record<string, RuleResult> = {};

function RuleSettings({ node, rule }: { node: GraphNode; rule: Rule }) {
  const status = useNodeStatus(node.id);
  const columns = status.state === 'ok' ? status.columns : [];
  const form = ruleForm(rule.type);
  const update = (patch: Partial<Rule>) => apply((p) => updateRule(p, node.id, rule.id, patch));
  return (
    <div className="flex flex-col gap-3 border-t border-line px-2 py-3" data-testid="rule-settings">
      <Field label="Severity" htmlFor="rule-severity" hint="A failing rule blocks export from an Output node; a warning doesn’t.">
        <Select
          id="rule-severity"
          options={[
            { value: 'fail', label: 'Fail' },
            { value: 'warn', label: 'Warn' },
          ]}
          value={rule.severity}
          onChange={(e) => update({ severity: e.target.value as Rule['severity'] })}
        />
      </Field>
      <Switch id="rule-enabled" label="Enabled" checked={rule.enabled} onChange={(enabled) => update({ enabled })} />
      {form && (
        <FormFields
          testId="rule-form"
          fields={form.fields}
          params={rule.params}
          errors={ruleErrors(rule)}
          columns={columns}
          onChange={(params) => update({ params, label: ruleLabel({ type: rule.type, params }) })}
        />
      )}
      <div>
        <Button size="sm" variant="ghost" icon="cross" onClick={() => apply((p) => removeRule(p, node.id, rule.id))}>
          Delete rule
        </Button>
      </div>
    </div>
  );
}

/** A node's quality rules: what it expects of its output, each with its latest result. */
export function RulesPanel({ node }: { node: GraphNode }) {
  const results = useRuleStore((s) => s.nodes[node.id]?.results ?? NONE);
  const status = useNodeStatus(node.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = ruleForms().map((f) => ({
    label: f.title,
    onSelect: () => {
      const rule = newRule(f.type, { selected: useSession.getState().selectedColumns, available: status.state === 'ok' ? status.columns : [] });
      apply((p) => addRule(p, node.id, rule));
      setSelectedId(rule.id);
    },
  }));
  return (
    <Section title="Rules" count={node.rules.length} action={<Menu label="Add rule" button={{ variant: 'ghost', size: 'sm', icon: 'plus' }} items={items} />}>
      {node.rules.length ? (
        <div className="flex flex-col" data-testid="rules">
          {node.rules.map((r) => {
            const res = results[r.id];
            return (
              <div key={r.id}>
                <RuleRow
                  name={r.label}
                  severity={r.severity}
                  disabled={!r.enabled}
                  pending={!res || res.state === 'pending'}
                  error={res?.state === 'error' ? res.message : undefined}
                  failures={res?.state === 'ok' ? res.failures : 0}
                  total={res?.state === 'ok' ? res.total : undefined}
                  selected={selectedId === r.id}
                  onSelect={() => setSelectedId(selectedId === r.id ? null : r.id)}
                  onShowFailing={() => showFailing(node.id, r.id)}
                />
                {selectedId === r.id && <RuleSettings node={node} rule={r} />}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-ink-muted">No rules yet. Add one to say what this data should look like.</p>
      )}
    </Section>
  );
}
