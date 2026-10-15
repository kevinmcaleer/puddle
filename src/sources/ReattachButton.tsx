import { useRef } from 'react';
import { useSession } from '../app/session';
import type { Source } from '../model';
import { Button } from '../ui';
import { reattachFile } from './attach';
import { ACCEPT } from './detect';

/** "Choose file": connect a detached source to its file again. */
export function ReattachButton({ source, label = 'Choose file' }: { source: Source; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button size="sm" variant="primary" icon="source" onClick={() => input.current?.click()}>{label}</Button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        data-testid={`reattach-${source.id}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          reattachFile(source, file).catch((err: unknown) => useSession.getState().notify({ tone: 'fail', text: err instanceof Error ? err.message : String(err) }));
        }}
      />
    </>
  );
}
