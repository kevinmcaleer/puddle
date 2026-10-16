// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, useProjectStore, type Source } from '../model';
import { filesNotKeptMessage } from './attach';
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
      'This browser can’t keep access to files between visits, so choose orders.csv again from its node. In Chrome or Edge, Puddle reopens files with one click.',
    );
    expect(filesNotKeptMessage(['a.csv', 'b.csv', 'c.csv'])).toContain('choose a.csv, b.csv and 1 more again from their nodes.');
  });

  it('shows where the browser has no file handles, for detached files only, until dismissed', () => {
    render(<FilesNotKeptBanner supported={false} />);
    expect(screen.getByRole('status').textContent).toContain('Files aren’t kept in this browser');
    expect(screen.getByRole('status').textContent).toContain('choose orders.csv again from its node');
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
