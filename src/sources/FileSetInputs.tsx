import type { RefObject } from 'react';
import { FILE_SET_ACCEPT } from './detect';

/**
 * The hidden inputs that choose a file set: several files at once, or a folder (every file in it and its subfolders).
 * A click on either ref opens the browser's picker; `onFiles` gets what was chosen.
 */
export function FileSetInputs({ files, folder, onFiles, testId }: { files: RefObject<HTMLInputElement | null>; folder: RefObject<HTMLInputElement | null>; onFiles: (files: File[]) => void; testId: string }) {
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (chosen.length) onFiles(chosen);
  };
  return (
    <>
      <input ref={files} type="file" multiple accept={FILE_SET_ACCEPT} hidden data-testid={testId} onChange={take} />
      {/* webkitdirectory isn't in React's types; every current browser reads it. */}
      <input ref={folder} type="file" multiple hidden data-testid={`${testId}-folder`} onChange={take} {...{ webkitdirectory: '' }} />
    </>
  );
}
