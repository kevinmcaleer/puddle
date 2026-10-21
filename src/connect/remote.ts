// A connection that runs in puddle-connect (on this computer or the Pi): the same Connector interface over its
// routes. The service is src/connect/server.ts; this is the browser's side of it.
import type { Catalog } from '../model';
import type { CatalogDetail } from './types';
import { secretFor, SERVICE_TOKEN_ID } from '../connections/secrets';
import { serviceBase, serviceBody, type Fetch } from '../connections/service';
import { ConnectorError, type Connector, type ConnectorContext, type ReadRequest } from './types';

const notRunning = (via: string) => (via === 'local' ? 'puddle-connect isn’t running on this computer. Start it with “npx puddle-connect”, then try again.' : 'puddle-connect isn’t answering on the Pi.');

export function remoteConnector(ctxVia: 'local' | 'pi', fetchImpl: Fetch = fetch): Connector {
  const call = async (ctx: ConnectorContext, route: string, extra: Record<string, unknown> = {}, signal?: AbortSignal): Promise<Response> => {
    const token = ctxVia === 'pi' ? secretFor(SERVICE_TOKEN_ID) : undefined;
    let res: Response;
    try {
      res = await fetchImpl(`${serviceBase(ctxVia)}/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ ...serviceBody(ctx.connection, ctx.secret), ...extra }),
        ...(signal ? { signal } : {}),
      });
    } catch {
      if (signal?.aborted) throw new ConnectorError('The read was cancelled.');
      throw new ConnectorError(notRunning(ctxVia));
    }
    if (res.status === 401) throw new ConnectorError('The Pi’s service refused the token.');
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ConnectorError(text || `The service answered ${res.status}.`);
    }
    return res;
  };
  return {
    id: 'postgres',
    runsIn: [ctxVia],
    async test(ctx) {
      const body = (await (await call(ctx, 'test')).json()) as { ok?: boolean; server?: string; reason?: string };
      return body.ok ? { ok: true, server: body.server ?? 'Connected' } : { ok: false, reason: body.reason ?? 'The database refused the connection.' };
    },
    async catalog(ctx) {
      return (await (await call(ctx, 'catalog')).json()) as Catalog;
    },
    async document(ctx) {
      return (await (await call(ctx, 'document')).json()) as CatalogDetail;
    },
    async read(ctx, req: ReadRequest) {
      const res = await call(ctx, 'read', { table: req.table, query: req.query, limit: req.limit }, ctx.signal);
      const columns = JSON.parse(res.headers.get('Puddle-Columns') ?? '[]') as { name: string; sqlType: string }[];
      const rows = Number(res.headers.get('Puddle-Rows') ?? 0);
      // Cancelling tells the service to stop the read it named, as well as dropping the stream.
      const id = res.headers.get('Puddle-Read-Id');
      const cancel = () => {
        if (id) void call(ctx, 'cancel', { id }).catch(() => undefined);
      };
      ctx.signal?.addEventListener('abort', cancel, { once: true });
      try {
        return { columns, rows, ipc: new Uint8Array(await res.arrayBuffer()) };
      } catch (e) {
        if (ctx.signal?.aborted) throw new ConnectorError('The read was cancelled.');
        throw new ConnectorError(`The rows couldn’t be read (${e instanceof Error ? e.message : String(e)}).`);
      } finally {
        ctx.signal?.removeEventListener('abort', cancel);
      }
    },
  };
}
