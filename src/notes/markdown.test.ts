// @vitest-environment jsdom
import { renderMarkdown } from './markdown';

/** Render into a detached element, the way the preview does, and return it for inspection. */
const rendered = (text: string) => {
  const el = document.createElement('div');
  el.innerHTML = renderMarkdown(text);
  return el;
};

/** Every attribute on every element, to check no event handler or style slipped through. */
const attributes = (el: Element) => Array.from(el.querySelectorAll('*')).flatMap((e) => Array.from(e.attributes).map((a) => a.name));

describe('renderMarkdown', () => {
  it('renders headings, emphasis, lists, code and quotes', () => {
    const el = rendered('# Plan\n\nClean **orders** and *customers*.\n\n- trim\n- dedupe\n\n1. one\n\n`code`\n\n```\nselect 1\n```\n\n> quoted');
    expect(el.querySelector('h1')?.textContent).toBe('Plan');
    expect(el.querySelector('strong')?.textContent).toBe('orders');
    expect(el.querySelector('em')?.textContent).toBe('customers');
    expect(Array.from(el.querySelectorAll('ul li')).map((li) => li.textContent)).toEqual(['trim', 'dedupe']);
    expect(el.querySelector('ol li')?.textContent).toBe('one');
    expect(el.querySelector('p code')?.textContent).toBe('code');
    expect(el.querySelector('pre code')?.textContent).toBe('select 1\n');
    expect(el.querySelector('blockquote')?.textContent?.trim()).toBe('quoted');
  });

  it('shows script and HTML as text', () => {
    const note = '<script>window.hacked = 1</script>\n\n<img src=x onerror="alert(1)">\n\nInline <b onclick="x()">bold</b> and <iframe src="https://example.com"></iframe>';
    const el = rendered(note);
    expect(el.querySelectorAll('script, img, iframe, b, style, object, embed')).toHaveLength(0);
    expect(attributes(el).filter((a) => a.startsWith('on') || a === 'style' || a === 'src')).toEqual([]);
    expect(el.textContent).toContain('<script>window.hacked = 1</script>');
    expect(el.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(el.textContent).toContain('<b onclick="x()">bold</b>');
  });

  it('opens links in a new tab without access to this one', () => {
    const el = rendered('[Docs](https://duckdb.org/docs) and https://example.com/a');
    const links = Array.from(el.querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://duckdb.org/docs', 'https://example.com/a']);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('drops script links', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,<script>alert(1)</script>']) {
      const el = rendered(`[click](${href})`);
      expect(el.querySelectorAll('a')).toHaveLength(0);
      expect(el.textContent).toContain('[click]');
    }
  });

  it('never fetches images', () => {
    const el = rendered('![tracker](https://example.com/pixel.png)');
    expect(el.querySelectorAll('img')).toHaveLength(0);
  });
});
