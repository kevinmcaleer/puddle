import { useEffect } from 'react';
import { HomeScreen } from '../home/HomeScreen';
import { ProjectDialogs } from '../home/ProjectDialogs';
import { startAutosave, startWorkspace, useWorkspace } from '../persistence/workspace';
import { startSync } from '../sync';
import { SyncDialogs } from '../sync/SyncDialogs';
import { AppShell } from './AppShell';

export function App() {
  const screen = useWorkspace((s) => s.screen);
  useEffect(() => startAutosave(), []);
  useEffect(() => startSync(), []);
  useEffect(() => {
    void startWorkspace();
  }, []);
  return (
    <>
      {screen === 'home' && <HomeScreen />}
      {screen === 'editor' && <AppShell />}
      <ProjectDialogs />
      <SyncDialogs />
    </>
  );
}
