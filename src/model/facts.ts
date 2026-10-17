// Facts about a source's data (which file it read, what its address served last) are recorded as they are learnt,
// never as undo steps. Undo and redo restore an earlier project, so they carry these over: going back to before an
// edit mustn't also go back to an older file than the one attached now. (Detected columns aren't carried: they follow
// the read options, which are undoable, and are detected again as soon as the flow runs.)
import type { Project, Source } from './schema';

function withFacts(to: Source, from: Source): Source {
  const file = from.file && to.kind === 'file' ? from.file : to.file;
  const url = to.url && from.url && to.url.href === from.url.href && (to.url.headHash !== from.url.headHash || to.url.size !== from.url.size) ? { ...to.url, headHash: from.url.headHash, size: from.url.size } : to.url;
  if (file === to.file && url === to.url) return to;
  return { ...to, file, url };
}

/** `to` with each source's data facts taken from the same source in `from`, where it has them. */
export function carryFacts(to: Project, from: Project): Project {
  if (to.sources === from.sources) return to;
  let changed = false;
  const sources = to.sources.map((s) => {
    const f = from.sources.find((x) => x.id === s.id);
    const next = f && f !== s ? withFacts(s, f) : s;
    if (next !== s) changed = true;
    return next;
  });
  return changed ? { ...to, sources } : to;
}
