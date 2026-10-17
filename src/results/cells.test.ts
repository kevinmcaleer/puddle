import { GridCellKind } from '@glideapps/glide-data-grid';
import { nullTheme, resultCell } from './cells';

const subtle = nullTheme({ textLight: 'grey', baseFontStyle: '12px' });

describe('result cells', () => {
  it('draws a loading cell until the page arrives', () => {
    expect(resultCell(undefined, 'text', subtle).kind).toBe(GridCellKind.Loading);
  });

  it('shows nulls as subtle italic "null" that copies as empty', () => {
    expect(resultCell(null, 'integer', subtle)).toMatchObject({ kind: GridCellKind.Text, displayData: 'null', copyData: '', themeOverride: { textDark: 'grey', baseFontStyle: 'italic 12px' } });
  });

  it('right-aligns numbers only, and never allows editing', () => {
    expect(resultCell('3.5', 'decimal', subtle)).toMatchObject({ contentAlign: 'right', readonly: true, allowOverlay: false, data: '3.5' });
    expect(resultCell('7', 'integer', subtle)).toMatchObject({ contentAlign: 'right' });
    expect(resultCell('Ada', 'text', subtle)).toMatchObject({ contentAlign: 'left' });
    expect(resultCell('', 'text', subtle)).toMatchObject({ displayData: '' });
  });
});

describe('result cells in a display locale', () => {
  const de = { locale: 'de-DE', dates: 'locale' } as const;

  it('shows numbers and dates in the locale, but keeps the data and what copies as DuckDB wrote it', () => {
    expect(resultCell('1234.5', 'decimal', subtle, de)).toMatchObject({ data: '1234.5', displayData: '1.234,5', copyData: '1234.5' });
    expect(resultCell('2026-12-31', 'date', subtle, de)).toMatchObject({ data: '2026-12-31', displayData: '31.12.2026', copyData: '2026-12-31' });
    expect(resultCell('1234', 'text', subtle, de)).toMatchObject({ displayData: '1234' });
    expect(resultCell(null, 'decimal', subtle, de)).toMatchObject({ displayData: 'null', copyData: '' });
  });
});
