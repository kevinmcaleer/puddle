// A tiny local HTTP server for URL source tests: serves files from memory, with or without CORS headers and
// range support, and records each request so tests can see how a file was read.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ServedFile {
  body: Uint8Array | string;
  type?: string;
}

export interface FileServerOptions {
  /** Send Access-Control-Allow-Origin (and expose Content-Range). Off, browsers refuse to hand pages the reply. */
  cors?: boolean;
  /** Answer Range requests with 206 Partial Content. Off, the whole file comes back with 200. */
  ranges?: boolean;
  /** Answer 401 unless the request's Authorization header is this. */
  authorization?: string;
}

export interface FileServer {
  url: (path: string) => string;
  /**
   * Files by path, e.g. "/customers.csv", or by path and query ("/People?%24skiptoken=4"), which wins over the path
   * alone. Change them between requests to simulate a file changing.
   */
  files: Map<string, ServedFile>;
  requests: { method: string; path: string; search?: string; range?: string; authorization?: string }[];
  close: () => Promise<void>;
}

const bytes = (b: Uint8Array | string) => (typeof b === 'string' ? Buffer.from(b) : Buffer.from(b));

export async function startFileServer(opts: FileServerOptions = {}): Promise<FileServer> {
  const files = new Map<string, ServedFile>();
  const requests: FileServer['requests'] = [];
  const server: Server = createServer((req: IncomingMessage, res) => {
    const { pathname: path, search } = new URL(req.url ?? '/', 'http://x');
    const range = req.headers.range;
    const authorization = req.headers.authorization;
    requests.push({ method: req.method ?? 'GET', path, ...(search ? { search } : {}), ...(range ? { range } : {}), ...(authorization ? { authorization } : {}) });
    if (opts.cors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Authorization');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (opts.authorization && authorization !== opts.authorization) {
      res.writeHead(401, { 'Content-Type': 'text/plain', 'WWW-Authenticate': 'Basic' }).end('Sign in');
      return;
    }
    const file = files.get(path + search) ?? files.get(path);
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const body = bytes(file.body);
    const headers: Record<string, string> = { 'Content-Type': file.type ?? 'application/octet-stream', 'Cache-Control': 'no-store' };
    if (opts.ranges) headers['Accept-Ranges'] = 'bytes';
    const m = opts.ranges && range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    if (m) {
      const start = Number(m[1]);
      const end = Math.min(m[2] ? Number(m[2]) : body.length - 1, body.length - 1);
      const part = body.subarray(start, end + 1);
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': String(part.length) });
      res.end(req.method === 'HEAD' ? undefined : part);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': String(body.length) });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (path) => `http://127.0.0.1:${port}${path}`,
    files,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
