import { describe, expect, it } from 'vitest';
import { hueOf, toneOf } from './palette';

describe('DBML colours on the palette', () => {
  it('reads #rgb and #rrggbb', () => {
    expect(hueOf('#f00')).toMatchObject({ hue: 0, saturation: 1 });
    expect(hueOf('#00ff00')?.hue).toBe(120);
    expect(hueOf('blue')).toBeUndefined();
  });

  it('maps the colours dbdiagram.io offers to the nearest tone', () => {
    expect(toneOf('#3498DB')).toBe('blue');
    expect(toneOf('#1ABC9C')).toBe('teal');
    expect(toneOf('#8E44AD')).toBe('purple');
    expect(toneOf('#F39C12')).toBe('amber');
    expect(toneOf('#E74C3C')).toBe('red');
    expect(toneOf('#7F8C8D')).toBe('grey');
  });

  it('draws black, white and greys as grey', () => {
    expect(toneOf('#000')).toBe('grey');
    expect(toneOf('#ffffff')).toBe('grey');
    expect(toneOf('#999')).toBe('grey');
  });

  it('has no tone without a hex colour', () => {
    expect(toneOf(undefined)).toBeUndefined();
    expect(toneOf('none')).toBeUndefined();
  });
});
