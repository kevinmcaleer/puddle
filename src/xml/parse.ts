/**
 * A small streaming XML reader: text goes in as chunks, element starts, text and element ends come out as calls.
 * It never builds the whole document, so a file far larger than the DOM could hold is read in one pass. Pure: no
 * DOM, so it runs in the browser, in a worker, in tests and in puddle-run alike.
 *
 * It reads well-formed XML: elements, attributes, text, CDATA, the five named entities and numeric character
 * references. Comments, processing instructions and the DOCTYPE are skipped; entities a DTD declares are left as
 * written. Namespaces are not resolved: names keep their prefix, and localName drops it.
 */

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlError';
  }
}

export interface XmlHandler {
  open(name: string, attributes: [string, string][]): void;
  text(text: string): void;
  close(name: string): void;
}

/** "d:Name" to "Name". */
export const localName = (name: string) => name.slice(name.indexOf(':') + 1);

/** Namespace declarations, which say what a prefix means rather than holding data. */
export const isNamespaceDeclaration = (name: string) => name === 'xmlns' || name.startsWith('xmlns:');

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Replace entity and character references with what they stand for; unknown entities stay as written. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ref] ?? whole;
  });
}

const NAME = /^[^\s/>="'<]+/;
const ATTRIBUTE = /\s*([^\s=/>"']+)\s*=\s*("([^"]*)"|'([^']*)')/y;

function parseTag(body: string, line: number): { name: string; attributes: [string, string][]; selfClosing: boolean } {
  const selfClosing = body.endsWith('/');
  const inner = selfClosing ? body.slice(0, -1) : body;
  const name = NAME.exec(inner)?.[0];
  if (!name) throw new XmlError(`Line ${line}: a tag has no name.`);
  const attributes: [string, string][] = [];
  let at = (ATTRIBUTE.lastIndex = name.length);
  let m: RegExpExecArray | null;
  while ((m = ATTRIBUTE.exec(inner))) {
    attributes.push([m[1]!, decodeEntities(m[3] ?? m[4] ?? '')]);
    at = ATTRIBUTE.lastIndex;
  }
  if (inner.slice(at).trim()) throw new XmlError(`Line ${line}: the attributes of <${name}> aren’t written as name="value".`);
  return { name, attributes, selfClosing };
}

/** The end of a tag starting at `from` (the index of its '<'): the '>' outside quotes, or -1 if not in the buffer yet. */
function tagEnd(buf: string, from: number): number {
  let quote = '';
  for (let i = from + 1; i < buf.length; i++) {
    const c = buf[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

/** The end of a DOCTYPE, past its internal subset in [ ], or -1. */
function doctypeEnd(buf: string, from: number): number {
  let depth = 0;
  let quote = '';
  for (let i = from; i < buf.length; i++) {
    const c = buf[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '>' && depth <= 0) return i;
  }
  return -1;
}

const countLines = (text: string, from: number, to: number) => {
  let n = 0;
  for (let i = text.indexOf('\n', from); i !== -1 && i < to; i = text.indexOf('\n', i + 1)) n++;
  return n;
};

/**
 * Feed text in with push(), in pieces of any size (a tag may be split across two), then call end(). Throws
 * XmlError, with the line, when the text isn't well-formed XML.
 */
export class XmlReader {
  private buf = '';
  private open: string[] = [];
  private line = 1;
  private seenRoot = false;

  constructor(private readonly handler: XmlHandler) {}

  /** Elements open at this point, outermost first. */
  get depth() {
    return this.open.length;
  }

  push(chunk: string): void {
    this.buf += chunk;
    this.drain(false);
  }

  end(): void {
    this.drain(true);
    if (this.buf.trim()) throw new XmlError(`Line ${this.line}: the XML stops in the middle of a tag.`);
    if (this.open.length) throw new XmlError(`The XML ends before <${this.open[this.open.length - 1]}> is closed. The file may be cut short.`);
    if (!this.seenRoot) throw new XmlError('There are no elements in this XML.');
  }

  private text(text: string) {
    if (!text) return;
    if (!this.open.length) {
      if (text.trim()) throw new XmlError(this.seenRoot ? `Line ${this.line + countLines(text, 0, text.search(/\S/))}: there is text after the last element closes.` : 'This isn’t XML: it doesn’t start with a tag.');
      return;
    }
    this.handler.text(decodeEntities(text));
  }

  private drain(final: boolean) {
    const buf = this.buf;
    let i = 0;
    while (i < buf.length) {
      const lt = buf.indexOf('<', i);
      if (lt === -1) {
        // Text up to the end of the buffer; held back unless this is the end, as an entity may be split.
        if (!final) break;
        this.text(buf.slice(i));
        this.line += countLines(buf, i, buf.length);
        i = buf.length;
        break;
      }
      if (lt > i) {
        this.text(buf.slice(i, lt));
        this.line += countLines(buf, i, lt);
        i = lt;
      }
      let end: number;
      if (buf.startsWith('<!--', i)) {
        end = buf.indexOf('-->', i + 4);
        if (end === -1) break;
        end += 2;
      } else if (buf.startsWith('<![CDATA[', i)) {
        end = buf.indexOf(']]>', i + 9);
        if (end === -1) break;
        if (!this.open.length) throw new XmlError(`Line ${this.line}: CDATA outside any element.`);
        this.handler.text(buf.slice(i + 9, end));
        end += 2;
      } else if (buf.startsWith('<?', i)) {
        end = buf.indexOf('?>', i + 2);
        if (end === -1) break;
        end += 1;
      } else if (buf.startsWith('<!', i)) {
        if (buf.length - i < 9 && !final) break;
        end = doctypeEnd(buf, i);
        if (end === -1) break;
      } else {
        end = tagEnd(buf, i);
        if (end === -1) break;
        this.tag(buf.slice(i + 1, end).trim());
      }
      this.line += countLines(buf, i, end);
      i = end + 1;
    }
    this.buf = buf.slice(i);
  }

  private tag(body: string) {
    if (body.startsWith('/')) {
      const name = body.slice(1).trim();
      const top = this.open.pop();
      if (top === undefined) throw new XmlError(`Line ${this.line}: </${name}> closes an element that was never opened.`);
      if (top !== name) throw new XmlError(`Line ${this.line}: </${name}> is closing <${top}>. A tag is missing or misspelled.`);
      this.handler.close(name);
      return;
    }
    if (this.seenRoot && !this.open.length) throw new XmlError(`Line ${this.line}: there is more than one top-level element. XML has one element around everything.`);
    const { name, attributes, selfClosing } = parseTag(body, this.line);
    this.seenRoot = true;
    this.handler.open(name, attributes);
    if (selfClosing) this.handler.close(name);
    else this.open.push(name);
  }
}

const CHUNK = 1 << 20;

/** XML as it arrives: a string, bytes, a file, or a stream of text pieces. */
export type XmlInput = string | Uint8Array | Blob | (() => AsyncIterable<string>);

/** The encoding a byte-order mark or the XML declaration names, else UTF-8. */
export function sniffEncoding(head: Uint8Array): string {
  if (head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
  if (head[0] === 0xfe && head[1] === 0xff) return 'utf-16be';
  const decl = new TextDecoder('latin1').decode(head.subarray(0, 200));
  const named = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([\w.:-]+)["']/.exec(decl)?.[1];
  if (!named) return 'utf-8';
  try {
    return new TextDecoder(named).encoding;
  } catch {
    return 'utf-8';
  }
}

async function* bytesToText(chunks: AsyncIterable<Uint8Array>): AsyncIterable<string> {
  let decoder: TextDecoder | undefined;
  for await (const bytes of chunks) {
    decoder ??= new TextDecoder(sniffEncoding(bytes));
    const text = decoder.decode(bytes, { stream: true });
    if (text) yield text;
  }
  const rest = decoder?.decode();
  if (rest) yield rest;
}

async function* sliced<T extends string | Uint8Array>(whole: T): AsyncIterable<T> {
  for (let i = 0; i < whole.length; i += CHUNK) yield whole.slice(i, i + CHUNK) as T;
}

async function* blobChunks(blob: Blob): AsyncIterable<Uint8Array> {
  // Read in slices rather than blob.stream(), which jsdom's Blob lacks; each await lets the page breathe.
  for (let i = 0; i < blob.size; i += CHUNK) yield new Uint8Array(await blob.slice(i, i + CHUNK).arrayBuffer());
}

/** The input as text pieces, decoded from bytes where need be. Each call starts again from the beginning. */
export function textChunks(input: XmlInput): AsyncIterable<string> {
  if (typeof input === 'string') return sliced(input);
  if (typeof input === 'function') return input();
  if (input instanceof Uint8Array) return bytesToText(sliced(input));
  return bytesToText(blobChunks(input));
}

/** Read the whole input through a handler. */
export async function readXml(input: XmlInput, handler: XmlHandler): Promise<void> {
  const reader = new XmlReader(handler);
  for await (const chunk of textChunks(input)) reader.push(chunk);
  reader.end();
}
