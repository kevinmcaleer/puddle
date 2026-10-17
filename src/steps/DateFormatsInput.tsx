import { useEffect, useRef, useState } from 'react';
import { parseLocale } from '../compiler';
import { describeFormat, orderOf, swapDayMonth, unreadValues, type Detection, type Order } from '../dates';
import { Banner, Button, cx } from '../ui';
import { CommitInput } from './CommitInput';

const pct = (matched: number, total: number) => (total ? `${Math.round((matched / total) * 100)}%` : '0%');

/** Every day and month format turned the other way round, without repeats. */
const turn = (formats: string[]) => [...new Set(formats.map((f) => (orderOf(f) ? swapDayMonth(f)! : f)))];

/**
 * The formats a parse dates step tries, in order, with the formats detected on its column, how many values each
 * reads, and the values none of the step's formats reads. Day and month order is never guessed: an ambiguous column
 * asks, or follows values that fit only one order, or the step's locale (and follows it again when the locale
 * changes), saying so each time.
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
  // Which order is in use (the first day and month format's), shown either way so it's never settled silently.
  const chosen = value.map(orderOf).find((o): o is Order => o != null);
  // Choosing an order puts the formats detected for it first, keeping any others.
  const pick = (o: Order) => amb && onChange([...amb.covers[o], ...value.filter((f) => !amb.covers[o].includes(f))]);
  const rate = (f: string) => detection?.ranked.find((m) => m.format === f);
  const unread = detection && value.length ? unreadValues(detection, value) : undefined;
  const detected = detection?.formats;
  const sameAsDetected = detected != null && detected.length === value.length && detected.every((f, i) => value[i] === f);

  // The locale's order is used once detection for a column and locale is in: when no order is chosen yet, and in
  // place of the other order when the locale or column has just changed. An order picked by hand, or a format removed,
  // under the same locale stands.
  const seen = useRef<string | null>(null);
  const byLocale = amb?.byLocale ? parseLocale(amb.byLocale) : undefined;
  const localeOrder: Order | undefined = byLocale ? (byLocale.dayFirst ? 'day' : 'month') : undefined;
  useEffect(() => {
    if (!detection || seen.current === key) return;
    const first = seen.current === null;
    seen.current = key;
    if (!amb || !localeOrder) return;
    if (chosen === localeOrder || (chosen && first)) return;
    if (chosen) onChange(turn(value));
    else pick(localeOrder);
  });

  /** Why the order in use is the one it is, or a prompt to check it. */
  const why = () => {
    if (!amb) return '';
    const byLocaleText = byLocale && chosen === localeOrder ? `this is the order ${byLocale.label} uses.` : undefined;
    if (amb.mixed) return `Some values fit only day first (${amb.mixed.day}) and others only month first (${amb.mixed.month}), so not all can be read; ${byLocaleText ?? 'check this is the order most of the data uses.'}`;
    const either = amb.example ? `${amb.example} could be read either way; ` : 'These values could be read either way; ';
    if (amb.byValues && chosen === amb.order) return `${either}${amb.byValues} can only be read this way.`;
    return either + (byLocaleText ?? 'check this is the order the data uses.');
  };

  return (
    <div id={id} className="flex flex-col gap-2" data-testid="date-formats">
      {amb && !chosen && (
        <Banner tone="warn" title="Day and month order is unclear">
          {amb.mixed ? `Some values fit only day first (${amb.mixed.day}) and others only month first (${amb.mixed.month}). ` : amb.example ? `${amb.example} could be read either way. ` : ''}Choose
          which comes first.
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => pick('day')}>
              Day first ({describeFormat(amb.dayFirst)})
            </Button>
            <Button size="sm" onClick={() => pick('month')}>
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
            <Button size="sm" variant="ghost" onClick={() => onChange(turn(value))}>
              {chosen === 'day' ? 'Read month first' : 'Read day first'}
            </Button>
          }
        >
          {why()}
        </Banner>
      )}
      {unread && unread.count > 0 && (
        <Banner tone="warn" title={`${unread.count} of ${unread.total} values fit none of these formats`}>
          {`They can’t be read as dates: ${unread.examples.map((v) => `“${v}”`).join(', ')}${unread.count > unread.examples.length ? ' and more' : ''}. Add a format that reads them, or fix them first.`}
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
          {detected && detected.length > 0 && !sameAsDetected && (
            <Button size="sm" onClick={() => onChange(detected)}>
              {detected.length === 1 ? 'Use the detected format' : `Use the ${detected.length} detected formats`}
            </Button>
          )}
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
