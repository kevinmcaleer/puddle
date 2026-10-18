const FORMAT_LABEL: Record<string, string> = { csv: 'CSV', tsv: 'TSV', json: 'JSON', ndjson: 'NDJSON', parquet: 'Parquet', xlsx: 'Excel', xml: 'XML' };

/** How a source format is named in the UI. */
export const formatLabel = (f: string) => FORMAT_LABEL[f] ?? f;

/** How a source's format is named: "Web table" for a table read from a web page and "OData" for a feed, both read as CSV. */
export const sourceFormatLabel = (s: { format: string; url?: { table?: unknown; odata?: unknown } }) => (s.url?.odata ? 'OData' : s.url?.table ? 'Web table' : formatLabel(s.format));
