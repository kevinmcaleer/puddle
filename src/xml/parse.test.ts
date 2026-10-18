import { decodeEntities, localName, readXml, sniffEncoding, XmlReader, type XmlHandler } from './parse';

/** Every call the reader makes, as short strings. */
function recorder() {
  const calls: string[] = [];
  const handler: XmlHandler = {
    open: (name, attributes) => calls.push(`<${name}${attributes.map(([a, v]) => ` ${a}=${v}`).join('')}>`),
    text: (text) => calls.push(text),
    close: (name) => calls.push(`</${name}>`),
  };
  return { calls, handler };
}

async function events(xml: string) {
  const { calls, handler } = recorder();
  await readXml(xml, handler);
  return calls;
}

describe('the streaming XML reader', () => {
  it('reads elements, attributes in either quote, self-closing tags, CDATA and entities, skipping comments, PIs and the DOCTYPE', async () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE note [<!ENTITY x "y"> <!ELEMENT note (#PCDATA)>]>
<!-- a comment with <tags> in it -->
<note a="1 &gt; 0" b='it&apos;s'><to/><![CDATA[<raw> & stuff]]>&#65;&#x42;&lt;&unknown;</note>`;
    expect(await events(xml)).toEqual(['<note a=1 > 0 b=it\'s>', '<to>', '</to>', '<raw> & stuff', 'AB<&unknown;', '</note>']);
  });

  it('gives the same calls however the text is split, even inside a tag, a quoted ">" or a comment', async () => {
    const xml = `<a x="p>q"><!-- c --><b>one &amp; two</b><![CDATA[z]]></a>`;
    const whole = await events(xml);
    for (let size = 1; size < xml.length; size++) {
      const { calls, handler } = recorder();
      const reader = new XmlReader(handler);
      for (let i = 0; i < xml.length; i += size) reader.push(xml.slice(i, i + size));
      reader.end();
      // Text may arrive in pieces; joined, it is the same.
      expect(calls.join('')).toBe(whole.join(''));
    }
  });

  it('says plainly, with the line, what is wrong with XML that isn’t well formed', async () => {
    await expect(events('name,age\nAnn,3')).rejects.toThrow('This isn’t XML: it doesn’t start with a tag.');
    await expect(events('<a>\n<b>\n</c></a>')).rejects.toThrow('Line 3: </c> is closing <b>. A tag is missing or misspelled.');
    await expect(events('<a><b></b>')).rejects.toThrow('The XML ends before <a> is closed. The file may be cut short.');
    await expect(events('<a/><b/>')).rejects.toThrow('there is more than one top-level element');
    await expect(events('<a x=1/>')).rejects.toThrow('the attributes of <a> aren’t written as name="value"');
    await expect(events('<!-- only a comment -->')).rejects.toThrow('There are no elements in this XML.');
    await expect(events('<a>text</a>\nmore')).rejects.toThrow('Line 2: there is text after the last element closes.');
  });

  it('decodes bytes in the encoding the declaration or byte-order mark names', async () => {
    const latin = new Uint8Array([...new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?><a>caf'), 0xe9, ...new TextEncoder().encode('</a>')]);
    expect(sniffEncoding(latin)).toBe('windows-1252');
    const { calls, handler } = recorder();
    await readXml(latin, handler);
    expect(calls).toEqual(['<a>', 'café', '</a>']);

    const utf16 = new Uint8Array([0xff, 0xfe, ...[...'<a>é</a>'].flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(sniffEncoding(utf16)).toBe('utf-16le');
    const r = recorder();
    await readXml(new Blob([utf16]), r.handler);
    expect(r.calls).toEqual(['<a>', 'é', '</a>']);
    expect(sniffEncoding(new TextEncoder().encode('<a/>'))).toBe('utf-8');
  });

  it('drops namespace prefixes for local names, and leaves undeclared entities as written', () => {
    expect(localName('d:Name')).toBe('Name');
    expect(localName('Name')).toBe('Name');
    expect(decodeEntities('&copy; &#0; &#x110000; &amp;amp;')).toBe('&copy; &#0; &#x110000; &amp;');
  });
});
