// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UrlSourceError } from './address';
import { authorization, CORS_MESSAGE, connect, duckType, feedColumns, feedUrl, fetchFeed, pageOf, parseMetadata, parseServiceDocument, readFeed, rowsToCsv, timestampText, timeText, type FeedSpec } from './odata';

const fixture = (name: string) => readFileSync(join(__dirname, '../../tests/fixtures/odata', name), 'utf8');
const TRIPPIN = 'https://services.odata.org/TripPinRESTierService';
const NORTHWIND = 'https://services.odata.org/V2/Northwind/Northwind.svc';

type Call = { href: string; headers: Record<string, string> };

/**
 * A fetch that answers by address (path and query, exactly); an answer of undefined is the browser's bare refusal
 * (CORS), and an address it doesn't know gets a 404.
 */
function fakeFetch(answers: Record<string, (() => Response) | undefined>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = String(input);
    calls.push({ href, headers: (init?.headers ?? {}) as Record<string, string> });
    if (!(href in answers)) return new Response('Not found', { status: 404 });
    const answer = answers[href];
    if (!answer) throw new TypeError('Failed to fetch');
    return answer();
  }) as typeof fetch;
  return { impl, calls };
}

const xml = (body: string) => () => new Response(body, { headers: { 'content-type': 'application/xml' } });
const json = (body: unknown) => () => Response.json(body);
const page = (name: string) => json(JSON.parse(fixture(name)));

const trippin = () => ({
  [`${TRIPPIN}/$metadata`]: xml(fixture('trippin-metadata.xml')),
  [`${TRIPPIN}/People`]: page('trippin-people-1.json'),
  [`${TRIPPIN}/People?%24skiptoken=4`]: page('trippin-people-2.json'),
  [`${TRIPPIN}/People?%24skiptoken=8`]: page('trippin-people-3.json'),
});

describe('EDM types', () => {
  it('maps each to the DuckDB type it is read as', () => {
    expect(['Edm.String', 'Edm.Int32', 'Edm.Int64', 'Edm.Int16', 'Edm.Byte', 'Edm.SByte', 'Edm.Boolean', 'Edm.Double', 'Edm.Single', 'Edm.Guid', 'Edm.Date', 'Edm.TimeOfDay', 'Edm.DateTimeOffset', 'Edm.DateTime', 'Edm.Time', 'Edm.Duration', 'Edm.Binary'].map((t) => duckType(t))).toEqual([
      'VARCHAR', 'INTEGER', 'BIGINT', 'SMALLINT', 'UTINYINT', 'TINYINT', 'BOOLEAN', 'DOUBLE', 'FLOAT', 'UUID', 'DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMP', 'TIME', 'VARCHAR', 'VARCHAR',
    ]);
  });

  it('keeps a decimal’s precision and scale where they fit DuckDB, else reads it as a double', () => {
    expect(duckType('Edm.Decimal', { precision: '19', scale: '4' })).toBe('DECIMAL(19,4)');
    expect(duckType('Edm.Decimal', { precision: '10' })).toBe('DECIMAL(10,0)');
    expect(duckType('Edm.Decimal', { precision: '10', scale: 'variable' })).toBe('DOUBLE');
    expect(duckType('Edm.Decimal', { precision: '40', scale: '2' })).toBe('DOUBLE');
    expect(duckType('Edm.Decimal')).toBe('DOUBLE');
  });

  it('reads structured values as their JSON text, and leaves out media streams', () => {
    expect(duckType('Collection(Edm.String)')).toBe('VARCHAR');
    expect(duckType('Edm.GeographyPoint')).toBe('VARCHAR');
    expect(duckType('Trippin.Location')).toBe('VARCHAR');
    expect(duckType('Edm.Stream')).toBeUndefined();
  });
});

describe('$metadata', () => {
  it('lists TripPin’s entity sets (version 4), with enums and complex types as text and navigation left out', () => {
    const m = parseMetadata(fixture('trippin-metadata.xml'));
    expect(m.version).toBe(4);
    expect(m.entitySets.map((s) => s.name)).toEqual(['People', 'Airlines', 'Airports']);
    expect(m.entitySets[0]!.properties!.map((p) => [p.name, p.type])).toEqual([
      ['UserName', 'VARCHAR'],
      ['FirstName', 'VARCHAR'],
      ['LastName', 'VARCHAR'],
      ['MiddleName', 'VARCHAR'],
      ['Gender', 'VARCHAR'],
      ['Age', 'BIGINT'],
      ['Emails', 'VARCHAR'],
      ['AddressInfo', 'VARCHAR'],
      ['HomeAddress', 'VARCHAR'],
      ['FavoriteFeature', 'VARCHAR'],
      ['Features', 'VARCHAR'],
    ]);
  });

  it('reads Northwind’s version 2 metadata, where the container is in another schema', () => {
    const m = parseMetadata(fixture('northwind-v2-metadata.xml'));
    expect(m.version).toBe(2);
    const products = m.entitySets.find((s) => s.name === 'Products')!;
    expect(products.properties!.find((p) => p.name === 'UnitPrice')).toEqual({ name: 'UnitPrice', edm: 'Edm.Decimal', type: 'DECIMAL(19,4)' });
    expect(m.entitySets.find((s) => s.name === 'Orders')!.properties!.map((p) => p.type)).toEqual(['INTEGER', 'VARCHAR', 'TIMESTAMP', 'TIMESTAMP', 'TIME', 'DECIMAL(19,4)', 'VARCHAR']);
  });

  it('puts inherited columns first, and follows aliases and type definitions', () => {
    const m = parseMetadata(`<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"><edmx:DataServices>
      <Schema Namespace="Shop.Model" Alias="S" xmlns="http://docs.oasis-open.org/odata/ns/edm">
        <TypeDefinition Name="Money" UnderlyingType="Edm.Decimal" Precision="12" Scale="2" />
        <EntityType Name="Item" Abstract="true"><Property Name="Id" Type="Edm.Int32" /><Property Name="Photo" Type="Edm.Stream" /></EntityType>
        <EntityType Name="Product" BaseType="S.Item"><Property Name="Price" Type="S.Money" /></EntityType>
        <EntityContainer Name="C"><EntitySet Name="Products" EntityType="Shop.Model.Product" /></EntityContainer>
      </Schema></edmx:DataServices></edmx:Edmx>`);
    expect(m.entitySets[0]!.properties!.map((p) => [p.name, p.type])).toEqual([
      ['Id', 'INTEGER'],
      ['Price', 'DECIMAL(12,2)'],
    ]);
  });

  it('refuses a document that isn’t metadata', () => {
    expect(() => parseMetadata('<html><body>Hello</body></html>')).toThrow(UrlSourceError);
    expect(() => parseMetadata('not xml at all')).toThrow(UrlSourceError);
  });
});

describe('the service document', () => {
  it('lists the entity sets of version 4 (not singletons or functions) and version 2', () => {
    expect(parseServiceDocument(JSON.parse(fixture('trippin-service.json')))).toEqual({ version: 4, entitySets: [{ name: 'People' }, { name: 'Airlines' }, { name: 'Airports' }] });
    expect(parseServiceDocument({ d: { EntitySets: ['Products', 'Orders'] } })).toEqual({ version: 2, entitySets: [{ name: 'Products' }, { name: 'Orders' }] });
  });

  it('isn’t fooled by a feed’s rows, which have a value too', () => {
    expect(parseServiceDocument(JSON.parse(fixture('trippin-people-1.json')))).toBeUndefined();
    expect(parseServiceDocument('nope')).toBeUndefined();
  });
});

describe('connecting to a service', () => {
  it('reads $metadata at the service root', async () => {
    const { impl, calls } = fakeFetch(trippin());
    const c = await connect(TRIPPIN + '/', { fetchImpl: impl });
    expect(c.service.root.href).toBe(TRIPPIN);
    expect(c.service.version).toBe(4);
    expect(c.service.entitySets.map((s) => s.name)).toEqual(['People', 'Airlines', 'Airports']);
    expect(c.entitySet).toBeUndefined();
    expect(calls).toEqual([{ href: `${TRIPPIN}/$metadata`, headers: { Accept: 'application/xml' } }]);
  });

  it('takes an entity set’s address, as copied from the address bar, with its query options', async () => {
    const { impl } = fakeFetch(trippin());
    const c = await connect(`${TRIPPIN}/People?$select=UserName,FirstName&$filter=FirstName eq 'Scott'&$top=5`, { fetchImpl: impl });
    expect(c).toMatchObject({ entitySet: 'People', select: ['UserName', 'FirstName'], filter: "FirstName eq 'Scott'", top: 5 });
    expect(c.service.root.href).toBe(TRIPPIN);
  });

  it('takes the $metadata address itself', async () => {
    const { impl } = fakeFetch(trippin());
    expect((await connect(`${TRIPPIN}/$metadata`, { fetchImpl: impl })).service.root.href).toBe(TRIPPIN);
  });

  it('falls back to the service document when there is no $metadata', async () => {
    const { impl } = fakeFetch({ [TRIPPIN]: page('trippin-service.json') });
    const c = await connect(TRIPPIN, { fetchImpl: impl });
    expect(c.service.entitySets).toEqual([{ name: 'People' }, { name: 'Airlines' }, { name: 'Airports' }]);
  });

  it('says when there is no service at the address', async () => {
    const { impl } = fakeFetch({});
    await expect(connect('https://open.example/nothing', { fetchImpl: impl })).rejects.toMatchObject({ kind: 'format', message: expect.stringContaining('There’s no OData service at this address (open.example)') });
  });

  it('says when the service blocks other sites, once every address has been tried', async () => {
    const { impl, calls } = fakeFetch({ [`${TRIPPIN}/$metadata`]: undefined, [TRIPPIN]: undefined, 'https://services.odata.org/$metadata': undefined, 'https://services.odata.org/': undefined });
    await expect(connect(TRIPPIN, { fetchImpl: impl })).rejects.toMatchObject({ kind: 'cors', message: CORS_MESSAGE });
    // Nothing but the service's own addresses: no server of Puddle's own.
    expect(calls.every((c) => c.href.startsWith('https://services.odata.org/'))).toBe(true);
  });

  it('isn’t put off by an entity set’s address whose /$metadata answers without CORS headers', async () => {
    // Regression: an error page without CORS headers looks to the browser just like a service that blocks other
    // sites, so the guess at People/$metadata used to stop the search before the service's own $metadata.
    const { impl } = fakeFetch({ ...trippin(), [`${TRIPPIN}/People/$metadata`]: undefined });
    const c = await connect(`${TRIPPIN}/People`, { fetchImpl: impl });
    expect(c.entitySet).toBe('People');
    expect(c.service.root.href).toBe(TRIPPIN);
  });

  it('says so when offline, rather than blaming the service', async () => {
    const { impl } = fakeFetch({ [`${TRIPPIN}/$metadata`]: undefined });
    await expect(connect(TRIPPIN, { fetchImpl: impl, online: () => false })).rejects.toMatchObject({ kind: 'offline' });
  });

  it('asks for a sign-in when the service wants one, and says when it’s turned down', async () => {
    const { impl, calls } = fakeFetch({ [`${TRIPPIN}/$metadata`]: () => new Response('', { status: 401 }) });
    await expect(connect(TRIPPIN, { fetchImpl: impl })).rejects.toMatchObject({ kind: 'auth', message: expect.stringContaining('This service needs a sign-in (401)') });
    await expect(connect(TRIPPIN, { fetchImpl: impl, credentials: { kind: 'basic', user: 'kev', password: 'nope' } })).rejects.toMatchObject({
      kind: 'auth',
      message: expect.stringContaining('Check the user name and password'),
    });
    expect(calls[1]!.headers.Authorization).toBe('Basic a2V2Om5vcGU=');
  });
});

describe('sign-ins', () => {
  it('sends Basic as UTF-8 in base64, and a bearer token as it is', () => {
    expect(authorization({ kind: 'basic', user: 'Aladdin', password: 'open sesame' })).toBe('Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==');
    expect(authorization({ kind: 'basic', user: 'zoë', password: 'pässword' })).toBe(`Basic ${Buffer.from('zoë:pässword').toString('base64')}`);
    expect(authorization({ kind: 'bearer', token: 'abc.def' })).toBe('Bearer abc.def');
  });

  it('sends the sign-in only to the service’s own origin, not to a next link elsewhere', async () => {
    const { impl, calls } = fakeFetch({
      [`${TRIPPIN}/People`]: json({ value: [{ UserName: 'a' }], '@odata.nextLink': 'https://elsewhere.example/People?page=2' }),
      'https://elsewhere.example/People?page=2': json({ value: [{ UserName: 'b' }] }),
    });
    await readFeed(new URL(TRIPPIN), { entitySet: 'People', version: 4, auth: 'bearer' }, { fetchImpl: impl, credentials: { kind: 'bearer', token: 't' } });
    expect(calls.map((c) => c.headers.Authorization)).toEqual(['Bearer t', undefined]);
  });

  it('asks for the sign-in again when a source needs one and this tab has none', async () => {
    const { impl, calls } = fakeFetch({});
    await expect(readFeed(new URL(TRIPPIN), { entitySet: 'People', version: 4, auth: 'basic' }, { fetchImpl: impl })).rejects.toMatchObject({ kind: 'auth', message: expect.stringContaining('Sign in to read this feed') });
    expect(calls).toHaveLength(0);
  });
});

describe('a feed’s address', () => {
  it('writes the query options the way every server reads them', () => {
    const url = feedUrl(new URL(TRIPPIN + '/'), { entitySet: 'People', select: ['UserName', 'Age'], filter: " Age gt 30 and startswith(LastName,'W') ", top: 10 });
    expect(url.href).toBe(`${TRIPPIN}/People?$select=UserName,Age&$filter=Age%20gt%2030%20and%20startswith(LastName%2C%27W%27)&$top=10`);
    expect(feedUrl(new URL(TRIPPIN), { entitySet: 'People' }).href).toBe(`${TRIPPIN}/People`);
  });
});

describe('pages', () => {
  it('reads version 4 (value and @odata.nextLink), 3 (odata.nextLink) and 2 (d.results and __next, or d alone)', () => {
    expect(pageOf({ value: [{ a: 1 }], '@odata.nextLink': 'n' })).toEqual({ rows: [{ a: 1 }], next: 'n' });
    expect(pageOf({ value: [], 'odata.nextLink': 'm' })).toEqual({ rows: [], next: 'm' });
    expect(pageOf({ d: { results: [{ a: 1 }], __next: 'p' } })).toEqual({ rows: [{ a: 1 }], next: 'p' });
    expect(pageOf({ d: [{ a: 1 }] })).toEqual({ rows: [{ a: 1 }] });
    expect(() => pageOf({ error: { message: 'x' } })).toThrow('isn’t a list of rows');
  });
});

describe('values', () => {
  it('reads dates and times as DuckDB reads them, in UTC when they carry an offset', () => {
    expect(timestampText('/Date(836438400000)/')).toBe('1996-07-04 00:00:00');
    expect(timestampText('/Date(836438400123+0060)/')).toBe('1996-07-04 00:00:00.123');
    expect(timestampText('/Date(-86400000)/')).toBe('1969-12-31 00:00:00');
    expect(timestampText('2014-01-01T00:00:00Z')).toBe('2014-01-01 00:00:00');
    expect(timestampText('2014-02-01T09:30:00.1234567+01:00')).toBe('2014-02-01 08:30:00.123456');
    expect(timestampText('2014-02-01T23:30-05:00')).toBe('2014-02-02 04:30:00');
    expect(timestampText('2014-02-01T09:30:00')).toBe('2014-02-01 09:30:00');
    expect(timestampText('soon')).toBe('soon');
    expect(timeText('PT13H20M')).toBe('13:20:00');
    expect(timeText('PT9H5M7.25S')).toBe('09:05:07.25');
    expect(timeText('13:20:00')).toBe('13:20:00');
  });

  it('writes CSV with nulls empty and empty strings quoted, structured values as JSON, and annotations left out', () => {
    const rows = [
      { '@odata.etag': 'W/"1"', Name: 'Tea, green', Note: '', Gone: null, Tags: ['a', 'b'], 'Tags@odata.type': '#Collection(String)', Price: 'INF' },
      { __metadata: { uri: 'x' }, Name: ' padded ', Note: 'He said "hi"', Category: { __deferred: { uri: 'y' } }, Extra: 1 },
    ];
    expect(rowsToCsv(rows)).toBe('Name,Note,Gone,Tags,Price,Extra\n"Tea, green","",,"[""a"",""b""]",INF,\n" padded ","He said ""hi""",,,,1\n');
    const typed = rowsToCsv(rows, [{ name: 'Price', type: 'DOUBLE' }, { name: 'Name', type: 'VARCHAR' }]);
    expect(typed).toBe('Price,Name\ninf,"Tea, green"\n," padded "\n');
  });

  it('takes the columns from $metadata, cut to $select in its order', () => {
    const set = parseMetadata(fixture('trippin-metadata.xml')).entitySets[0]!;
    expect(feedColumns(set, ['Age', 'UserName', 'Nope'])).toEqual([
      { name: 'Age', type: 'BIGINT' },
      { name: 'UserName', type: 'VARCHAR' },
      { name: 'Nope', type: 'VARCHAR' },
    ]);
    expect(feedColumns(set)).toHaveLength(11);
    expect(feedColumns({ name: 'X' })).toBeUndefined();
  });
});

describe('reading a feed', () => {
  const people = (spec: Partial<FeedSpec> = {}): FeedSpec => ({
    entitySet: 'People',
    version: 4,
    columns: feedColumns(parseMetadata(fixture('trippin-metadata.xml')).entitySets[0]!, spec.select),
    ...spec,
  });

  it('follows TripPin’s next links to the last page', async () => {
    const { impl, calls } = fakeFetch(trippin());
    const progress: number[] = [];
    const { csv, rows } = await readFeed(new URL(TRIPPIN), people(), { fetchImpl: impl, onProgress: (n) => progress.push(n) });
    expect(rows).toBe(10);
    expect(progress).toEqual([4, 8, 10]);
    expect(calls.map((c) => c.href)).toEqual([`${TRIPPIN}/People`, `${TRIPPIN}/People?%24skiptoken=4`, `${TRIPPIN}/People?%24skiptoken=8`]);
    expect(calls[0]!.headers).toEqual({ Accept: 'application/json' });
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('UserName,FirstName,LastName,MiddleName,Gender,Age,Emails,AddressInfo,HomeAddress,FavoriteFeature,Features');
    expect(lines[1]).toBe(
      'russellwhyte,Russell,Whyte,,Male,22,"[""Russell@example.com"",""Russell@contoso.com""]","[{""Address"":""187 Suffolk Ln."",""City"":{""Name"":""Boise"",""CountryRegion"":""United States"",""Region"":""ID""}}]",,Feature1,"[""Feature1"",""Feature2""]"',
    );
    expect(lines).toHaveLength(11);
  });

  it('stops at $top rows, even when the server has more pages', async () => {
    const answers = trippin();
    const { impl, calls } = fakeFetch({ ...answers, [`${TRIPPIN}/People?$top=6`]: answers[`${TRIPPIN}/People`] });
    const { rows } = await readFeed(new URL(TRIPPIN), people({ top: 6 }), { fetchImpl: impl });
    expect(rows).toBe(6);
    expect(calls).toHaveLength(2);
  });

  it('reads Northwind’s version 2 pages, with decimals as text and dates as /Date()/', async () => {
    const m = parseMetadata(fixture('northwind-v2-metadata.xml'));
    const { impl } = fakeFetch({
      [`${NORTHWIND}/Products`]: page('northwind-v2-products-1.json'),
      [`${NORTHWIND}/Products?$skiptoken=3`]: page('northwind-v2-products-2.json'),
      [`${NORTHWIND}/Orders`]: page('northwind-v2-orders.json'),
    });
    const products = await readFeed(new URL(NORTHWIND), { entitySet: 'Products', version: 2, columns: feedColumns(m.entitySets[0]!) }, { fetchImpl: impl });
    expect(products.rows).toBe(5);
    expect(products.csv.split('\n')[1]).toBe('1,Chai,1,1,10 boxes x 20 bags,18.0000,39,0,10,false');
    const orders = await readFeed(new URL(NORTHWIND), { entitySet: 'Orders', version: 2, columns: feedColumns(m.entitySets[1]!) }, { fetchImpl: impl });
    expect(orders.csv.split('\n').slice(1, 3)).toEqual(['10248,VINET,1996-07-04 00:00:00,1996-07-16 00:00:00,13:20:00,32.3800,Vins et alcools Chevalier', '10249,TOMSP,1996-07-05 00:00:00,,,11.6100,Toms Spezialitäten']);
  });

  it('stops if a next link points back at a page already read', async () => {
    const { impl, calls } = fakeFetch({ [`${TRIPPIN}/People`]: json({ value: [{ UserName: 'a' }], '@odata.nextLink': `${TRIPPIN}/People` }) });
    expect((await readFeed(new URL(TRIPPIN), { entitySet: 'People', version: 4 }, { fetchImpl: impl })).rows).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('passes on the service’s own error, such as a bad filter', async () => {
    const { impl } = fakeFetch({
      [`${TRIPPIN}/People?$filter=Age%20gt`]: () => Response.json({ error: { code: '', message: 'Syntax error at position 6 in \'Age gt\'.' } }, { status: 400, statusText: 'Bad Request' }),
    });
    await expect(readFeed(new URL(TRIPPIN), people({ filter: 'Age gt' }), { fetchImpl: impl })).rejects.toMatchObject({
      kind: 'status',
      message: 'The service answered 400 Bad Request (services.odata.org): Syntax error at position 6 in \'Age gt\'. Check the address and the query options, then try again.',
    });
  });

  it('says when an entity set with no columns known has no rows', async () => {
    const { impl } = fakeFetch({ [`${TRIPPIN}/People?$filter=Age%20gt%20200`]: json({ value: [] }) });
    await expect(readFeed(new URL(TRIPPIN), { entitySet: 'People', version: 4, filter: 'Age gt 200' }, { fetchImpl: impl })).rejects.toThrow('People has no rows that match the filter');
    const typed = await readFeed(new URL(TRIPPIN), people({ filter: 'Age gt 200' }), { fetchImpl: impl });
    expect(typed).toMatchObject({ rows: 0, csv: expect.stringMatching(/^UserName,FirstName,.*\n$/) });
  });

  it('hands DuckDB the CSV with a hash that notices a change', async () => {
    const { impl } = fakeFetch(trippin());
    const fetched = await fetchFeed(new URL(TRIPPIN), people(), { fetchImpl: impl });
    expect(fetched).toMatchObject({ format: 'csv', ranged: false, rows: 10, size: fetched.data!.byteLength });
    expect(fetched.headHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
