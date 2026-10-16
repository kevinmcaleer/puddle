import { useRef } from 'react';
import { useSession } from '../app/session';
import type { Source } from '../model';
import { Button } from '../ui';
import { reattachFile } from './attach';
import { ACCEPT } from './detect';
import { pickFiles, type PickedFile } from './handles';

const report = (err: unknown) => useSession.getState().notify({ tone: 'fail', text: err instanceof Error ? err.message : String(err) });

/**
 * "Choose file": connect a detached source to its file again. Where the browser keeps file handles (Chromium) the
 * picker's handle is kept too, so next time the file reconnects with a click.
 */
export function ReattachButton({ source, label = 'Choose file' }: { source: Source; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const choose = async () => {
    let picked: PickedFile[] | null;
    try {
      picked = await pickFiles(false);
    } catch (err) {
      return report(err);
    }
    if (picked === null) return input.current?.click();
    const [first] = picked;
    if (first) await reattachFile(source, first.file, first.handle).catch(report);
  };
  return (
    <>
      <Button size="sm" variant="primary" icon="source" onClick={() => void choose()}>{label}</Button>
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
          reattachFile(source, file).catch(report);
        }}
      />
    </>
  );
}
