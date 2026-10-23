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
    ...apps.map((app) => {
      const current = app.id === CURRENT_APP_ID;
      // An app that is not open yet is listed but cannot be chosen, unless it is the one you are in.
      const soon = app.status === 'soon' && !current;
      return {
        label: app.name,
        hint: soon ? 'Coming soon' : app.description,
        disabled: soon,
        group: "Kev's Power Tools",
        // The app you are in is ticked, and choosing it stays put.
        checked: current,
        onSelect: () => !current && navigate(app.url),
      };
    }),
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
