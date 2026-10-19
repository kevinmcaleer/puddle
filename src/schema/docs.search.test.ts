// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultDocsTokens, writeDocsHtml } from './docs';
import { parseDbml } from './parse';

const shop = parseDbml(readFileSync('tests/fixtures/dbml/shop.dbml', 'utf8')).schema;

/** The docs page loaded as this document, its inline script run as a browser would. */
function load(html: string) {
  const page = new DOMParser().parseFromString(html, 'text/html');
  document.replaceChild(document.adoptNode(page.documentElement), document.documentElement);
  const scripts = [...document.querySelectorAll('script')];
  expect(scripts).toHaveLength(1);
  new Function(scripts[0]!.textContent ?? '')();
}

const search = (text: string) => {
  const input = document.getElementById('docs-search') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input'));
};

const shownSections = () => [...document.querySelectorAll<HTMLElement>('section[data-search]')].filter((s) => !s.hidden).map((s) => s.id);
const shownToc = () => [...document.querySelectorAll<HTMLElement>('nav li[data-search]')].filter((li) => !li.hidden).map((li) => li.textContent);
const empty = () => document.getElementById('docs-search-empty')!.hidden === false;

describe('the docs search', () => {
  beforeEach(() => load(writeDocsHtml(shop, { title: 'Shop', views: [], tokens: defaultDocsTokens() })));

  it('shows every table until something is typed', () => {
    expect(shownSections()).toEqual(['table-customers', 'table-orders', 'table-products', 'table-order_items']);
    expect(empty()).toBe(false);
  });

  it('filters the table sections and the contents by table name, ignoring case', () => {
    search('ORDER');
    expect(shownSections()).toEqual(['table-orders', 'table-order_items']);
    expect(shownToc()).toEqual(['orders', 'order_items']);
  });

  it('finds tables by a column name, and says when nothing matches', () => {
    search('sku');
    expect(shownSections()).toEqual(['table-products']);
    search('nothing like this');
    expect(shownSections()).toEqual([]);
    expect(empty()).toBe(true);
    search('');
    expect(shownSections()).toHaveLength(4);
    expect(empty()).toBe(false);
  });

  it('leaves enums and groups in place', () => {
    search('sku');
    expect((document.getElementById('enum-order_status') as HTMLElement).hidden).toBe(false);
    expect((document.getElementById('group-sales') as HTMLElement).hidden).toBe(false);
  });
});
