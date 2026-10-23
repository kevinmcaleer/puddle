import { useState } from 'react';
import { Menu, type MenuItem } from '../ui';
import { BUNDLED_APPS, CURRENT_APP_ID, HOME_URL, loadApps, type PowerToolApp } from './apps';

let shared: Promise<PowerToolApp[]> | undefined;

/**
 * The switcher to Kev's other Power Tools, before the wordmark. It shows the built-in list at once and reads the shared
 * list the first time it opens, so nothing is fetched until you ask.
 */
export function AppSwitcher({ load = () => (shared ??= loadApps()), navigate = (url: string) => window.location.assign(url) }: { load?: () => Promise<PowerToolApp[]>; navigate?: (url: string) => void }) {
  const [apps, setApps] = useState(BUNDLED_APPS);
  const items: MenuItem[] = [
    ...apps.map((app) => ({
      label: app.name,
      hint: app.status === 'soon' ? 'Coming soon' : app.description,
      disabled: app.status === 'soon',
      group: "Kev's Power Tools",
      // The app you are in is ticked, and choosing it stays put.
      checked: app.id === CURRENT_APP_ID,
      onSelect: () => app.id !== CURRENT_APP_ID && navigate(app.url),
    })),
    { label: 'All tools', icon: 'web', hint: 'kevspowertools.com', onSelect: () => navigate(HOME_URL) },
  ];
  return (
    <Menu
      label="Switch app"
      align="start"
      button={{ variant: 'ghost', icon: 'apps', iconOnly: true, 'aria-label': 'Switch app', title: 'Switch app', ...{ 'data-testid': 'app-switcher' } }}
      items={items}
      onOpenChange={(open) => {
        if (open) void load().then(setApps);
      }}
    />
  );
}
