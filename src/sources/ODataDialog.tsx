import { useEffect, useRef, useState } from 'react';
import { addOData } from '../app/actions';
import { Banner, Dialog, Field, fullCount, Select, TextInput } from '../ui';
import { UrlSourceError, type UrlErrorKind } from './address';
import { connect, feedColumns, type Connected, type Credentials, type EntitySet } from './odata';
import { openODataDialog, useODataDialog } from './odataDialog';

type SignIn = 'none' | 'basic' | 'bearer';

const SIGN_INS = [
  { value: 'none', label: 'None' },
  { value: 'basic', label: 'Basic (user name and password)' },
  { value: 'bearer', label: 'Bearer token' },
];

const ERROR_TITLE: Partial<Record<UrlErrorKind | 'other', string>> = {
  cors: 'The service blocked this',
  auth: 'Sign-in needed',
  offline: 'You’re offline',
};

/** "11 columns: UserName, FirstName, LastName, MiddleName, Gender, Age and 5 more". */
function columnsHint(set: EntitySet): string {
  if (!set.properties) return 'The service doesn’t describe its columns, so they’re typed from the rows.';
  const names = set.properties.map((p) => p.name);
  const shown = names.slice(0, 6).join(', ') + (names.length > 6 ? ` and ${names.length - 6} more` : '');
  return `${names.length} ${names.length === 1 ? 'column' : 'columns'}: ${shown}`;
}

/** A typed $top: empty is none, a whole number above 0 is that many, anything else is refused (undefined). */
function parseTop(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  return /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : undefined;
}

/** A typed $select: names separated by commas. */
const parseSelect = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean);

function ODataForm() {
  const [address, setAddress] = useState('');
  const [signIn, setSignIn] = useState<SignIn>('none');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [found, setFound] = useState<Connected | null>(null);
  const [chosen, setChosen] = useState('');
  const [select, setSelect] = useState('');
  const [filter, setFilter] = useState('');
  const [top, setTop] = useState('');
  const [busy, setBusy] = useState<'connecting' | 'reading' | null>(null);
  const [read, setRead] = useState(0);
  const [error, setError] = useState<{ kind: UrlErrorKind | 'other'; message: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const close = () => openODataDialog(false);
  const fail = (e: unknown) => {
    if (e instanceof DOMException && e.name === 'AbortError') return;
    setBusy(null);
    setError({ kind: e instanceof UrlSourceError ? e.kind : 'other', message: e instanceof Error ? e.message : String(e) });
  };
  const credentials = (): Credentials | undefined =>
    signIn === 'basic' ? { kind: 'basic', user, password } : signIn === 'bearer' ? { kind: 'bearer', token: token.trim() } : undefined;
  // A changed address or sign-in means connecting again.
  const changed = () => {
    setFound(null);
    setError(null);
  };

  const set = found?.service.entitySets.find((s) => s.name === chosen);
  const topValue = parseTop(top);
  const submit = () => {
    if (busy) return;
    setError(null);
    abort.current?.abort();
    const controller = (abort.current = new AbortController());
    const opts = { credentials: credentials(), signal: controller.signal };
    if (!found || !set) {
      setBusy('connecting');
      connect(address, opts).then((c) => {
        setFound(c);
        setChosen(c.entitySet ?? c.service.entitySets[0]!.name);
        if (c.select) setSelect(c.select.join(', '));
        if (c.filter) setFilter(c.filter);
        if (c.top) setTop(String(c.top));
        setBusy(null);
      }, fail);
      return;
    }
    if (topValue === undefined) return;
    const columns = parseSelect(select);
    setBusy('reading');
    setRead(0);
    addOData(
      found.service.root,
      {
        entitySet: set.name,
        version: found.service.version,
        ...(columns.length ? { select: columns } : {}),
        ...(filter.trim() ? { filter: filter.trim() } : {}),
        ...(topValue ? { top: topValue } : {}),
        ...(feedColumns(set, columns) ? { columns: feedColumns(set, columns) } : {}),
        ...(signIn !== 'none' ? { auth: signIn } : {}),
      },
      { ...opts, onProgress: setRead },
    ).then(close, fail);
  };

  const confirm =
    busy === 'connecting' ? 'Connecting…' : busy === 'reading' ? (read ? `Reading… ${fullCount(read)} rows` : 'Reading…') : set ? 'Add source' : 'Connect';
  return (
    <Dialog title="Add source from an OData feed" className="w-[640px] max-w-[calc(100vw-32px)]" confirm={confirm} confirmDisabled={!!set && topValue === undefined} onClose={close} onConfirm={submit}>
      <Field label="Address" htmlFor="odata-address" hint="The service’s address, such as https://services.odata.org/TripPinRESTierService. The address of one entity set works too.">
        <TextInput
          id="odata-address"
          mono
          data-autofocus
          inputMode="url"
          spellCheck={false}
          placeholder="https://services.odata.org/TripPinRESTierService"
          value={address}
          error={!!error && (error.kind === 'address' || error.kind === 'format')}
          onChange={(e) => {
            setAddress(e.target.value);
            changed();
          }}
        />
      </Field>
      <Field label="Sign-in" htmlFor="odata-sign-in" hint={signIn === 'none' ? undefined : 'Kept in this tab only, never saved in the project or its file.'}>
        <Select
          id="odata-sign-in"
          options={SIGN_INS}
          value={signIn}
          onChange={(e) => {
            setSignIn(e.target.value as SignIn);
            changed();
          }}
        />
      </Field>
      {signIn === 'basic' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="User name" htmlFor="odata-user">
            <TextInput id="odata-user" autoComplete="username" spellCheck={false} value={user} onChange={(e) => (setUser(e.target.value), changed())} />
          </Field>
          <Field label="Password" htmlFor="odata-password">
            <TextInput id="odata-password" type="password" autoComplete="current-password" value={password} onChange={(e) => (setPassword(e.target.value), changed())} />
          </Field>
        </div>
      )}
      {signIn === 'bearer' && (
        <Field label="Token" htmlFor="odata-token">
          <TextInput id="odata-token" type="password" mono autoComplete="off" spellCheck={false} value={token} onChange={(e) => (setToken(e.target.value), changed())} />
        </Field>
      )}
      {found && set && (
        <div className="flex flex-col gap-3" data-testid="odata-sets">
          <Field
            label={found.service.entitySets.length === 1 ? 'Entity set' : `Entity set (${found.service.entitySets.length} in this service)`}
            htmlFor="odata-set"
            hint={`${columnsHint(set)}. OData version ${found.service.version}.`}
          >
            <Select id="odata-set" options={found.service.entitySets.map((s) => s.name)} value={chosen} onChange={(e) => setChosen(e.target.value)} />
          </Field>
          <Field label="Columns" htmlFor="odata-select" hint="Optional ($select): names separated by commas. Empty reads every column.">
            <TextInput id="odata-select" mono spellCheck={false} placeholder="UserName, FirstName, LastName" value={select} onChange={(e) => setSelect(e.target.value)} />
          </Field>
          <Field label="Filter" htmlFor="odata-filter" hint="Optional ($filter), read by the service, such as Age gt 30 or startswith(LastName,'W').">
            <TextInput id="odata-filter" mono spellCheck={false} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </Field>
          <Field label="Rows" htmlFor="odata-top" hint="Optional ($top): read at most this many. Empty reads them all, page by page." error={topValue === undefined ? 'Type a whole number above 0, or leave it empty.' : undefined}>
            <TextInput id="odata-top" mono inputMode="numeric" value={top} error={topValue === undefined} onChange={(e) => setTop(e.target.value)} />
          </Field>
        </div>
      )}
      {error && (
        <div data-testid="odata-error" data-kind={error.kind}>
          <Banner tone="fail" title={ERROR_TITLE[error.kind] ?? 'This feed can’t be read'}>
            {error.message}
          </Banner>
        </div>
      )}
    </Dialog>
  );
}

/** Add source › From OData feed. */
export function ODataDialog() {
  const open = useODataDialog((s) => s.open);
  return open ? <ODataForm /> : null;
}
