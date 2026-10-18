// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, useProjectStore, type Source } from '../model';
import { filesNotKeptMessage, matchFiles } from './attach';
import { useAttachments } from './attachments';
import { FilesNotKeptBanner } from './ReconnectBanner';

const file = (id: string): Source => ({ id, name: `${id}.csv`, kind: 'file', format: 'csv', parseOptions: {}, detectedSchema: [] });

describe('files not kept in this browser', () => {
  beforeEach(() => {
    useProjectStore.getState().load({ ...createProject('Shop'), sources: [file('orders'), file('customers'), { ...file('pasted'), kind: 'clipboard' }] });
    useAttachments.setState({ sources: { orders: 'detached', customers: 'attached', pasted: 'detached' } });
  });
  afterEach(cleanup);

  it('names the files to choose again, and points to the browsers that keep them', () => {
    expect(filesNotKeptMessage(['orders.csv'])).toBe(
      'Choose orders.csv again to read it. This browser can’t keep access to files between visits; Chrome and Edge reopen them with one click.',
    );
    expect(filesNotKeptMessage(['a.csv', 'b.csv', 'c.csv'])).toContain('Choose a.csv, b.csv and 1 more again to read them.');
  });

  it('shows where the browser has no file handles, for detached files only, until dismissed', () => {
    render(<FilesNotKeptBanner supported={false} />);
    // The same title as the one-click reconnect banner, so the two read as one thing (principle 10).
    expect(screen.getByRole('status').textContent).toContain('Files from last time');
    expect(screen.getByRole('status').textContent).toContain('Choose orders.csv again to read it');
    expect(screen.getByRole('button', { name: 'Choose 1 file' })).toBeTruthy();
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })));
    expect(screen.queryByTestId('files-not-kept-banner')).toBeNull();
  });

  it('stays away where the browser keeps file handles, or nothing needs choosing', () => {
    const { unmount } = render(<FilesNotKeptBanner supported />);
    expect(screen.queryByTestId('files-not-kept-banner')).toBeNull();
    unmount();
    act(() => useAttachments.setState({ sources: { orders: 'attached', customers: 'attached', pasted: 'detached' } }));
    render(<FilesNotKeptBanner supported={false} />);
    expect(screen.queryByTestId('files-not-kept-banner')).toBeNull();
  });
});

describe('matching files chosen together to the sources waiting for them', () => {
  const src = (id: string, originalName: string, format: Source['format'] = 'csv'): Source => ({ ...file(id), format, file: { originalName, size: 1, lastModified: 0, headHash: 'x' } });
  const f = (name: string) => ({ name });

  it('pairs by name, ignoring case, whatever order they were chosen in', () => {
    const pairs = matchFiles([src('o', 'orders.csv'), src('c', 'customers.csv')], [f('Customers.CSV'), f('orders.csv')]);
    expect(pairs.map((p) => [p.source.id, p.file.name])).toEqual([
      ['o', 'orders.csv'],
      ['c', 'Customers.CSV'],
    ]);
  });

  it('pairs a renamed file with the one source of its format left, and leaves out files that fit nothing', () => {
    const pairs = matchFiles([src('o', 'orders.csv'), src('p', 'prices.parquet', 'parquet')], [f('orders-2026.csv'), f('prices.parquet'), f('notes.pdf'), f('extra.parquet')]);
    expect(pairs.map((p) => [p.source.id, p.file.name])).toEqual([
      ['p', 'prices.parquet'],
      ['o', 'orders-2026.csv'],
    ]);
  });

  it('does not guess between two sources of the same format', () => {
    expect(matchFiles([src('a', 'a.csv'), src('b', 'b.csv')], [f('c.csv')])).toEqual([]);
  });
});
