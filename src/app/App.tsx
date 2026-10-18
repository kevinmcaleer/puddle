import { useEffect, useState } from 'react';
import { HomeScreen } from '../home/HomeScreen';
import { ProjectDialogs } from '../home/ProjectDialogs';
import { createProject } from '../model';
import { startAutosave, startWorkspace, startWorkspaceWith, useWorkspace } from '../persistence/workspace';
import { readShareHash, type SharePayload } from '../schema';
import { SharedSchema } from '../schema/SharedSchema';
import { startSync } from '../sync';
import { SyncDialogs } from '../sync/SyncDialogs';
import { LiveRegions } from '../ui';
import { useAnnouncements } from './announcements';
import { AppShell } from './AppShell';

/** Leave a share link's page for the app itself: its fragment goes, so a reload doesn't open the link again. */
const forgetShareLink = () => history.replaceState(null, '', `${location.pathname}${location.search}`);

/** A project holding a shared schema, laid out as it was shared. */
function sharedProject(payload: SharePayload) {
  const p = createProject('Shared schema');
  return { ...p, schema: { ...p.schema, dbml: payload.dbml, positions: payload.positions ?? {}, detail: payload.detail ?? 'full', views: payload.views ?? [] } };
}

export function App() {
  const screen = useWorkspace((s) => s.screen);
  // A share link opens its schema read-only before anything else, without touching the saved projects.
  const [shared, setShared] = useState(() => readShareHash(location.hash));
  useAnnouncements();
  useEffect(() => startAutosave(), []);
  useEffect(() => startSync(), []);
  useEffect(() => {
    if (!shared) void startWorkspace();
  }, [shared]);
  if (shared)
    return (
      <>
        <SharedSchema
          encoded={shared.encoded}
          embed={shared.embed}
          onOpen={(payload) => {
            forgetShareLink();
            void startWorkspaceWith(sharedProject(payload)).then(() => setShared(null));
          }}
          onLeave={() => {
            forgetShareLink();
            setShared(null);
          }}
        />
        <LiveRegions />
      </>
    );
  return (
    <>
      {screen === 'home' && <HomeScreen />}
      {screen === 'editor' && <AppShell />}
      <ProjectDialogs />
      <SyncDialogs />
      <LiveRegions />
    </>
  );
}
