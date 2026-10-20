import { src } from '../../tests/helpers/projects';
import { delimiterValue, hasParseOptions, parseNullStrings, withOption } from './options';

describe('read options', () => {
  it('drops an option set back to automatic, empty or an empty list', () => {
    const o = { delimiter: ';', quote: "'", nullStrings: ['NA'] };
    expect(withOption(o, 'delimiter', 'auto')).toEqual({ quote: "'", nullStrings: ['NA'] });
    expect(withOption(o, 'quote', '')).toEqual({ delimiter: ';', nullStrings: ['NA'] });
    expect(withOption(o, 'nullStrings', [])).toEqual({ delimiter: ';', quote: "'" });
    expect(withOption(o, 'header', false)).toEqual({ ...o, header: false });
    expect(o).toEqual({ delimiter: ';', quote: "'", nullStrings: ['NA'] });
  });

  it('splits treat-as-empty values on commas', () => {
    expect(parseNullStrings(' NA, n/a ,,-')).toEqual(['NA', 'n/a', '-']);
    expect(parseNullStrings('')).toEqual([]);
  });

  it('shows a TSV as tab-delimited and a CSV as detected until set', () => {
    expect(delimiterValue(src({ id: 'a', format: 'tsv' }))).toBe('\t');
    expect(delimiterValue(src({ id: 'a', format: 'csv' }))).toBe('auto');
    expect(delimiterValue(src({ id: 'a', format: 'csv', parseOptions: { delimiter: '|' } }))).toBe('|');
  });

  it('offers read options (the Format field at least) for every file, and for delimited text from a web address', () => {
    expect(hasParseOptions(src({ id: 'a', format: 'csv' }))).toBe(true);
    expect(hasParseOptions(src({ id: 'a', format: 'parquet' }))).toBe(true);
    expect(hasParseOptions({ ...src({ id: 'a', format: 'csv' }), kind: 'url', url: { href: 'https://x.example/a.csv', headHash: 'h' } })).toBe(true);
    expect(hasParseOptions({ ...src({ id: 'a', format: 'parquet' }), kind: 'url', url: { href: 'https://x.example/a.parquet', headHash: 'h' } })).toBe(false);
    expect(hasParseOptions({ ...src({ id: 'a', format: 'csv' }), kind: 'url', url: { href: 'https://x.example/', headHash: 'h', odata: { entitySet: 'People', version: 4 } } })).toBe(false);
  });
});
