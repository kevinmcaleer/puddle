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
