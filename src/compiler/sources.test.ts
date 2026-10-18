import type { Source } from '../model';
import { sourceRelation } from './sources';

const feed = (odata: NonNullable<NonNullable<Source['url']>['odata']>): Source => ({
  id: 'a',
  name: 'People',
  kind: 'url',
  format: 'csv',
  url: { href: 'https://services.odata.org/TripPinRESTierService', odata },
  parseOptions: { delimiter: ';' },
  detectedSchema: [],
});

describe('reading an OData feed', () => {
  it('reads the CSV Puddle wrote with the types from $metadata, keeping empty strings apart from nulls', () => {
    expect(sourceRelation(feed({ entitySet: 'People', version: 4, columns: [{ name: 'UserName', type: 'VARCHAR' }, { name: "O'Age", type: 'BIGINT' }] }))).toBe(
      `read_csv('src_a.csv', header = true, delim = ',', quote = '"', escape = '"', allow_quoted_nulls = false, columns = {'UserName': 'VARCHAR', 'O''Age': 'BIGINT'})`,
    );
  });

  it('lets DuckDB type the columns when the service has no $metadata, and ignores read options', () => {
    expect(sourceRelation(feed({ entitySet: 'People', version: 4 }))).toBe(`read_csv('src_a.csv', header = true, delim = ',', quote = '"', escape = '"', allow_quoted_nulls = false)`);
  });
});
