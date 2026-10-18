// Share on the Schema view: a link that carries the schema itself in its #fragment, which the server never sees, and
// the same link as an embed for pages that allow iframes. Opening it shows the schema read-only.
import { useEffect, useState } from 'react';
import { copyText } from '../export/deliver';
import type { SchemaDoc } from '../model';
import { Banner, Button, Dialog, Field, Switch, TextInput } from '../ui';
import { embedSnippet, encodeShare, shareNotice, shareUrl } from './share';

/** Where a share link opens: this page, without its own fragment. */
const here = () => `${location.origin}${location.pathname}`;

export function ShareDialog({ doc, onClose }: { doc: SchemaDoc; onClose: () => void }) {
  const [encoded, setEncoded] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [embed, setEmbed] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    encodeShare({ dbml: doc.dbml, positions: doc.positions, detail: doc.detail, views: doc.views }).then(
      (e) => live && setEncoded(e),
      (e: Error) => live && setProblem(e.message),
    );
    return () => {
      live = false;
    };
  }, [doc]);
  const link = encoded ? shareUrl(here(), encoded) : '';
  const notice = link ? shareNotice(link) : null;
  const snippet = encoded && embed ? embedSnippet(shareUrl(here(), encoded, { embed: true })) : '';
  const copy = (text: string, done: string) =>
    void copyText(text).then(
      () => setSaid(done),
      (e: Error) => setSaid(e.message),
    );
  return (
    <Dialog title="Share the schema" onClose={onClose} className="w-[560px] max-w-[calc(100vw-32px)]">
      {problem && <Banner tone="fail">{problem}</Banner>}
      <Field label="Link" htmlFor="share-link">
        <TextInput id="share-link" mono readOnly value={link || 'Making the link…'} onFocus={(e) => e.currentTarget.select()} />
      </Field>
      {notice && (
        <div data-testid="share-notice">
          <Banner tone={notice.tooLong ? 'warn' : 'info'}>{notice.message}</Banner>
        </div>
      )}
      <div>
        <Button size="sm" variant="primary" icon="link" disabled={!link || !!notice?.tooLong} onClick={() => copy(link, 'Copied the link.')} data-autofocus>
          Copy link
        </Button>
      </div>
      <Switch id="share-embed" label="Embed the diagram in another page" checked={embed} onChange={setEmbed} />
      {snippet && (
        <>
          <pre className="puddle-schema-sql" tabIndex={0} aria-label="Embed code" data-testid="share-embed">
            {snippet}
          </pre>
          <div>
            <Button size="sm" variant="ghost" icon="paste" disabled={!!notice?.tooLong} onClick={() => copy(snippet, 'Copied the embed code.')}>
              Copy embed code
            </Button>
          </div>
        </>
      )}
      {said && (
        <p className="text-label text-ink-muted" role="status">
          {said}
        </p>
      )}
      <p className="text-label text-ink-muted">To share a project others can edit, with its data steps too, sync it to a GitHub Gist.</p>
    </Dialog>
  );
}
