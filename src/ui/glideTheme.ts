/**
 * Theme for Glide Data Grid. Glide draws on canvas and can't read CSS variables,
 * so call this again whenever the theme changes.
 */
export function glideTheme(el: Element = document.documentElement) {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue('--' + n).trim();
  return {
    accentColor: v('brand'), accentFg: v('on-brand'), accentLight: v('brand-tint'),
    textDark: v('ink'), textMedium: v('ink-muted'), textLight: v('ink-subtle'), textBubble: v('ink'),
    bgIconHeader: v('ink-muted'), fgIconHeader: v('surface-raised'), textHeader: v('ink'), textHeaderSelected: v('ink'),
    bgCell: v('surface-panel'), bgCellMedium: v('surface-sunken'), bgHeader: v('surface-sunken'),
    bgHeaderHasFocus: v('surface-hover'), bgHeaderHovered: v('surface-hover'), bgBubble: v('surface-sunken'), bgBubbleSelected: v('brand-tint'),
    bgSearchResult: v('accent-tint'), borderColor: v('line'), horizontalBorderColor: v('line'), drilldownBorder: v('line-strong'),
    linkColor: v('brand'), cellHorizontalPadding: 8, cellVerticalPadding: 4,
    headerFontStyle: '600 12px', baseFontStyle: '12px', markerFontStyle: '11px',
    fontFamily: v('font-mono'), editorFontSize: '12px', lineHeight: 1.4,
  };
}
