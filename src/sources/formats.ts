import { formatLabel } from '../canvas/formatLabel';
import type { SourceFormat } from '../model';

/** The formats a file on disk can be read as, for the Format picker and the Format field. */
export const FILE_FORMATS: SourceFormat[] = ['csv', 'tsv', 'fixed', 'pipes', 'log', 'json', 'ndjson', 'geojson', 'yaml', 'toml', 'ini', 'parquet', 'arrow', 'xlsx', 'xml', 'word', 'pdf', 'access'];
export const FORMAT_OPTIONS = FILE_FORMATS.map((f) => ({ value: f, label: formatLabel(f) }));

/** The formats the empty canvas names, the commonest first; the rest are "most other data files". */
export const WELCOME_FORMATS: SourceFormat[] = ['xlsx', 'csv', 'json', 'parquet', 'access'];

/** "Excel, CSV, JSON, Parquet, Access and most other data files": named from the formats that are read. */
export const welcomeFormats = (formats: SourceFormat[] = WELCOME_FORMATS) => `${formats.map(formatLabel).join(', ')} and most other data files`;
