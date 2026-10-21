#!/usr/bin/env python3
"""A stand-in for ClickHouse's HTTP interface on chdb (ClickHouse's embedded engine), for the tests where no
ClickHouse server can run: python3 scripts/clickhouse-stand-in.py [port] [password]. It answers POST / with the
query in the body and the settings in the address, as a server does (default_format, database, user, password,
readonly, output_format_*, add_http_cors_header), with ClickHouse's own error text and status. Seed it with
scripts/seed-clickhouse.mjs http://default:<password>@127.0.0.1:<port>/shop. Not for CI, which runs the real image."""
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from chdb import session

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 18123
PASSWORD = sys.argv[2] if len(sys.argv) > 2 else 'puddle'
SESSION = session.Session(tempfile.mkdtemp(prefix='puddle-chdb-'))
SETTINGS = ('output_format_json_quote_64bit_integers', 'output_format_json_quote_decimals', 'output_format_json_named_tuples_as_objects')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.command, self.path.split('?')[0]))

    def answer(self, status, body, cors):
        data = body.encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=UTF-8' if status == 200 else 'text/plain; charset=UTF-8')
        self.send_header('Content-Length', str(len(data)))
        if cors:
            self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        q = parse_qs(urlparse(self.path).query)
        p = lambda k, d='': q.get(k, [d])[0]
        cors = p('add_http_cors_header') == '1' and self.headers.get('Origin') is not None
        sql = self.rfile.read(int(self.headers.get('Content-Length', '0'))).decode()
        if p('user', 'default') != 'default' or p('password') != PASSWORD:
            return self.answer(403, 'Code: 516. DB::Exception: %s: Authentication failed: password is incorrect, or there is no user with such name. (AUTHENTICATION_FAILED)\n' % p('user', 'default'), cors)
        try:
            with LOCK:
                if p('database'):
                    SESSION.query('USE `%s`' % p('database').replace('`', ''))
                for s in SETTINGS:
                    if p(s):
                        SESSION.query('SET %s = %s' % (s, p(s)))
                if p('readonly') == '2' and not sql.lstrip().upper().startswith(('SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'EXISTS', 'EXPLAIN')):
                    return self.answer(500, 'Code: 164. DB::Exception: default: Cannot execute query in readonly mode. (READONLY)\n', cors)
                fmt = p('default_format', 'TabSeparated')
                out = SESSION.query(sql, fmt) if 'FORMAT ' not in sql.upper() else SESSION.query(sql)
                self.answer(200, str(out), cors)
        except Exception as e:  # noqa: BLE001
            self.answer(500, str(e) + '\n', cors)

    do_GET = do_POST


import threading

LOCK = threading.Lock()
print('ClickHouse stand-in on chdb listening on http://127.0.0.1:%d (user default, password %s)' % (PORT, PASSWORD), flush=True)
ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
