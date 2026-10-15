const FORMAT_LABEL: Record<string, string> = { csv: 'CSV', tsv: 'TSV', json: 'JSON', ndjson: 'NDJSON', parquet: 'Parquet', xlsx: 'Excel' };

/** How a source format is named in the UI. */
export const formatLabel = (f: string) => FORMAT_LABEL[f] ?? f;
