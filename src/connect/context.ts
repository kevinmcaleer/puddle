// What a connector call needs from the tab: the connection, its secret and file as this tab holds them, and the
// engine. Also Test for any connection, in the browser or through the service.
import { useEngineStore } from '../app/engine';
import { connectionFile } from '../connections/files';
import { secretFor } from '../connections/secrets';
import { testConnection, type TestResult } from '../connections/service';
import type { Connection } from '../model';
import { connectorFor } from './browser';
import type { ConnectorContext } from './types';

export function contextFor(connection: Connection, secret: string | undefined = secretFor(connection.id)): ConnectorContext {
  return { connection, secret, file: connectionFile(connection.id), engine: useEngineStore.getState().engine ?? undefined };
}

/** Open the connection and close it again: in the page for a browser connection, else through puddle-connect. */
export async function runTest(connection: Connection, secret: string | undefined): Promise<TestResult> {
  if (connection.via !== 'browser') return testConnection(connection, secret);
  try {
    const r = await (await connectorFor(connection)).test(contextFor(connection, secret));
    return r.ok ? { ok: true, detail: r.server } : { ok: false, detail: r.reason };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
