// Marks an editor draws on its text, such as the tables a SQL query names.

/** A stretch of the text an editor marks: a table name that was found (and the node it means), or one that wasn't. */
export interface TextMark {
  start: number;
  end: number;
  found: boolean;
  /** What the mark means to whoever asked for it, handed back while the pointer or caret is on it. */
  nodeId?: string;
}

/** The text cut at its marks, in order; marks that overlap an earlier one, or run past the text, are dropped. */
export function markedPieces(text: string, marks: TextMark[]): { text: string; mark?: TextMark }[] {
  const out: { text: string; mark?: TextMark }[] = [];
  let at = 0;
  for (const m of [...marks].sort((a, b) => a.start - b.start)) {
    if (m.start < at || m.end <= m.start || m.end > text.length) continue;
    if (m.start > at) out.push({ text: text.slice(at, m.start) });
    out.push({ text: text.slice(m.start, m.end), mark: m });
    at = m.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
