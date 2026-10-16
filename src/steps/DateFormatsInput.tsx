import { useEffect, useRef, useState } from 'react';
import { parseLocale } from '../compiler';
import { describeFormat, type Detection } from '../dates';
import { Banner, Button, cx } from '../ui';
import { CommitInput } from './CommitInput';

const pct = (matched: number, total: number) => (total ? `${Math.round((matched / total) * 100)}%` : '0%');

/**
 * The formats a parse dates step tries, in order, with the formats detected on its column and how many
 * values each reads. Day and month order is never guessed: an ambiguous column asks, or follows the step's locale
 * (and follows it again when the locale changes), saying so either way.
 */
export function DateFormatsInput({
  id,
  value,
  column,
  locale,
  detect,
  onChange,
}: {
  id: string;
  value: string[];
  column: string;
  /** The step's locale, which settles an unclear day and month order. */
  locale?: string;
  detect?: (column: string, locale?: string) => Promise<Detection>;
  onChange: (v: string[]) => void;
}) {
  const [found, setFound] = useState<{ key: string; detection: Detection } | null>(null);
  const key = `${column}|${locale ?? ''}`;
  useEffect(() => {
    if (!detect || !column) return;
    let live = true;
    detect(column, locale).then(
      (detection) => live && setFound({ key, detection }),
      () => live && setFound({ key, detection: { ranked: [] } }),
    );
    return () => {
      live = false;
    };
  }, [detect, column, locale, key]);
  const detection = found?.key === key ? found.detection : undefined;
  const add = (f: string) => !value.includes(f) && onChange([...value, f]);
  const amb = detection?.ambiguous;
  // Which of the two orders is in use (the earlier one, if both), shown either way so it's never settled silently.
  const di = amb ? value.indexOf(amb.dayFirst) : -1;
  const mi = amb ? value.indexOf(amb.monthFirst) : -1;
  const chosen = di < 0 && mi < 0 ? undefined : mi < 0 || (di >= 0 && di < mi) ? 'day' : 'month';
  const rate = (f: string) => detection?.ranked.find((m) => m.format === f);
  const swap = (from: string, to: string) => onChange(value.includes(to) ? value.filter((x) => x !== from) : value.map((x) => (x === from ? to : x)));

  // The locale's order is used once detection for a column and locale is in: when no order is chosen yet, and in
  // place of the other order when the locale or column has just changed. An order picked by hand, or a format removed,
  // under the same locale stands.
  const seen = useRef<string | null>(null);
  const byLocale = amb?.byLocale ? parseLocale(amb.byLocale) : undefined;
  useEffect(() => {
    if (!detection || seen.current === key) return;
    const first = seen.current === null;
    seen.current = key;
    if (!amb || !byLocale) return;
    const want = byLocale.dayFirst ? 'day' : 'month';
    if (chosen === want || (chosen && first)) return;
    const [from, to] = want === 'day' ? [amb.monthFirst, amb.dayFirst] : [amb.dayFirst, amb.monthFirst];
    if (chosen) swap(from, to);
    else onChange([to, ...value]);
  });

  return (
    <div id={id} className="flex flex-col gap-2" data-testid="date-formats">
      {amb && !chosen && (
        <Banner tone="warn" title="Day and month order is unclear">
          {amb.example ? `${amb.example} could be read either way. ` : ''}Choose which comes first.
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onChange([amb.dayFirst, ...value])}>
              Day first ({describeFormat(amb.dayFirst)})
            </Button>
            <Button size="sm" onClick={() => onChange([amb.monthFirst, ...value])}>
              Month first ({describeFormat(amb.monthFirst)})
            </Button>
          </div>
        </Banner>
      )}
      {amb && chosen && (
        <Banner
          tone="warn"
          title={chosen === 'day' ? 'Reading the day first' : 'Reading the month first'}
          action={
            <Button size="sm" variant="ghost" onClick={() => (chosen === 'day' ? swap(amb.dayFirst, amb.monthFirst) : swap(amb.monthFirst, amb.dayFirst))}>
              {chosen === 'day' ? 'Read month first' : 'Read day first'}
            </Button>
          }
        >
          {amb.example ? `${amb.example} could be read either way; ` : 'These values could be read either way; '}
          {byLocale && chosen === (byLocale.dayFirst ? 'day' : 'month') ? `this is the order ${byLocale.label} uses.` : 'check this is the order the data uses.'}
        </Banner>
      )}

      {value.length > 0 && (
        <ol className="flex flex-col gap-1" aria-label="Formats tried">
          {value.map((f, i) => (
            <li key={f} className="flex items-center gap-2">
              <span className="ui-metric w-4 text-right">{i + 1}</span>
              <code className="ui-mono flex-1">{f}</code>
              <span className="ui-metric">{describeFormat(f)}</span>
              {detection && <span className={cx('ui-metric', !rate(f) && 'text-warn')}>{rate(f) ? pct(rate(f)!.matched, rate(f)!.total) : `reads none of ${column}`}</span>}
              <Button variant="ghost" size="sm" icon="cross" iconOnly aria-label={`Remove ${f}`} onClick={() => onChange(value.filter((x) => x !== f))} />
            </li>
          ))}
        </ol>
      )}

      {detection && (
        <div className="flex flex-col gap-1" aria-label="Detected formats" role="group">
          <span className="text-label text-ink-muted">{detection.ranked.length ? `Detected in ${column}` : `No format reads ${column}`}</span>
          {detection.ranked.slice(0, 6).map((m) => {
            const used = value.includes(m.format);
            return (
              <button
                key={m.format}
                type="button"
                disabled={used}
                aria-label={`Use ${m.format}, reads ${pct(m.matched, m.total)}`}
                className={cx('ui-chip justify-between font-mono', used && 'opacity-50')}
                onClick={() => add(m.format)}
              >
                <span>{m.format}</span>
                <span className="ui-metric">
                  {pct(m.matched, m.total)} · {m.example}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <CommitInput key={value.join('|')} aria-label="Add a format" mono placeholder="%d %b %Y" value="" onCommit={(v) => v.trim() && add(v.trim())} />
    </div>
  );
}
