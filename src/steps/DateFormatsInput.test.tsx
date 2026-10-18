// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Detection } from '../dates';
import { DateFormatsInput } from './DateFormatsInput';

afterEach(cleanup);

const amb = { dayFirst: '%d/%m/%Y', monthFirst: '%m/%d/%Y', example: '03/04/2024', covers: { day: ['%d/%m/%Y'], month: ['%m/%d/%Y'] } };
/** Detection as rankFormats gives it: with a locale, the formats are the locale's order. */
const detect = vi.fn(async (_column: string, locale?: string): Promise<Detection> => {
  const ranked = [
    { format: '%d/%m/%Y', matched: 4, total: 4 },
    { format: '%m/%d/%Y', matched: 4, total: 4 },
  ];
  if (!locale) return { ranked, ambiguous: amb };
  const order = locale === 'en-US' ? 'month' : 'day';
  return { ranked, formats: amb.covers[order], ambiguous: { ...amb, order, byLocale: locale } };
});

/** The test's handles on the harness's state, set once it renders. */
const controls: { setLocale: (l: string | undefined) => void; setFormats: (f: string[]) => void } = { setLocale: () => undefined, setFormats: () => undefined };
function Harness({ initial, locale: start }: { initial: string[]; locale?: string }) {
  const [value, setValue] = useState(initial);
  const [locale, set] = useState(start);
  useEffect(() => {
    controls.setLocale = set;
    controls.setFormats = setValue;
  }, []);
  return (
    <>
      <output data-testid="value">{value.join(',')}</output>
      <DateFormatsInput id="f" value={value} column="d" locale={locale} detect={detect} onChange={setValue} />
    </>
  );
}

const value = () => screen.getByTestId('value').textContent;
const settle = () => act(async () => {});

describe('DateFormatsInput with a locale', () => {
  it('asks when there is no locale', async () => {
    render(<Harness initial={[]} />);
    await settle();
    expect(screen.getByText('Day and month order is unclear')).toBeInTheDocument();
    expect(value()).toBe('');
  });

  it('uses the locale’s order when none is chosen, and says why', async () => {
    render(<Harness initial={[]} locale="en-US" />);
    await settle();
    expect(value()).toBe('%m/%d/%Y');
    expect(screen.getByText('Reading the month first')).toBeInTheDocument();
    expect(screen.getByText(/this is the order English \(US\) uses/)).toBeInTheDocument();
  });

  it('follows a change of locale, but leaves a hand-picked order or a removed format alone', async () => {
    render(<Harness initial={['%d/%m/%Y']} />);
    await settle();
    expect(value()).toBe('%d/%m/%Y');
    await act(async () => controls.setLocale('en-US'));
    await settle();
    expect(value()).toBe('%m/%d/%Y');
    await act(async () => controls.setFormats(['%d/%m/%Y']));
    await settle();
    expect(value()).toBe('%d/%m/%Y');
    await act(async () => controls.setFormats([]));
    await settle();
    expect(value()).toBe('');
    await act(async () => controls.setLocale('en-GB'));
    await settle();
    expect(value()).toBe('%d/%m/%Y');
  });

  it('keeps an order picked before, when the step opens with its locale', async () => {
    render(<Harness initial={['%m/%d/%Y']} locale="en-GB" />);
    await settle();
    expect(value()).toBe('%m/%d/%Y');
    expect(screen.getByText(/check this is the order the data uses/)).toBeInTheDocument();
  });
});

describe('DateFormatsInput with detected formats', () => {
  const values = [
    { value: '2024-01-02', count: 3, reads: ['%Y-%m-%d'] },
    { value: '3 Feb 2024', count: 1, reads: ['%d %b %Y'] },
    { value: 'soon', count: 1, reads: [] },
  ];
  const found = async (): Promise<Detection> => ({
    ranked: [
      { format: '%Y-%m-%d', matched: 3, total: 5 },
      { format: '%d %b %Y', matched: 1, total: 5 },
    ],
    formats: ['%Y-%m-%d', '%d %b %Y'],
    values,
    tried: ['%Y-%m-%d', '%d %b %Y'],
  });

  it('says how many values no format reads, and puts the detected formats back', async () => {
    let value = ['%Y-%m-%d'];
    const onChange = vi.fn((v: string[]) => (value = v));
    const { rerender } = render(<DateFormatsInput id="f" value={value} column="d" detect={found} onChange={onChange} />);
    await settle();
    expect(screen.getByText('2 of 5 values fit none of these formats')).toBeInTheDocument();
    expect(screen.getByText(/“3 Feb 2024”, “soon”/)).toBeInTheDocument();

    act(() => screen.getByRole('button', { name: 'Use the 2 detected formats' }).click());
    expect(value).toEqual(['%Y-%m-%d', '%d %b %Y']);
    rerender(<DateFormatsInput id="f" value={value} column="d" detect={found} onChange={onChange} />);
    expect(screen.getByText('1 of 5 values fit none of these formats')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /detected formats/ })).toBeNull();
  });

  it('says nothing about unread values for a format detection didn’t try', async () => {
    render(<DateFormatsInput id="f" value={['%Y-%m-%d', '%e %b']} column="d" detect={found} onChange={() => undefined} />);
    await settle();
    expect(screen.queryByText(/fit none of these formats/)).toBeNull();
  });
});
