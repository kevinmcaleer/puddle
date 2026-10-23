// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSwitcher } from './AppSwitcher';
import { BUNDLED_APPS, HOME_URL } from './apps';

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Switch app' }));

describe('AppSwitcher', () => {
  afterEach(cleanup);

  it('lists the apps with Puddle ticked, and goes to another one', () => {
    const navigate = vi.fn();
    render(<AppSwitcher load={async () => BUNDLED_APPS} navigate={navigate} />);
    open();
    expect(screen.getByRole('menuitemradio', { name: /Puddle/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Mermaid Factory/ }));
    expect(navigate).toHaveBeenCalledWith('https://mermaid.kevspowertools.com/');
  });

  it('stays put when Puddle is chosen, and cannot go to an app that is coming soon', () => {
    const navigate = vi.fn();
    render(<AppSwitcher load={async () => BUNDLED_APPS} navigate={navigate} />);
    open();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Puddle/ }));
    open();
    const soon = screen.getByRole('menuitemradio', { name: /Wellyboot BI/ });
    expect((soon as HTMLButtonElement).disabled).toBe(true);
    expect(soon.textContent).toContain('Coming soon');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('goes to the landing page from All tools', () => {
    const navigate = vi.fn();
    render(<AppSwitcher load={async () => BUNDLED_APPS} navigate={navigate} />);
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: /All tools/ }));
    expect(navigate).toHaveBeenCalledWith(HOME_URL);
  });

  it('reads the shared list only once opened, then shows it', async () => {
    const load = vi.fn(async () => [{ id: 'new', name: 'New tool', url: 'https://new.kevspowertools.com/', status: 'live' as const }]);
    render(<AppSwitcher load={load} navigate={vi.fn()} />);
    expect(load).not.toHaveBeenCalled();
    await act(async () => open());
    expect(load).toHaveBeenCalledOnce();
    expect(screen.getByRole('menuitemradio', { name: /New tool/ })).toBeTruthy();
  });
});
