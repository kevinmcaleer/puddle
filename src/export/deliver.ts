// Handing an export to the person: a download, or the clipboard.

/** Download a Blob as a file. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function copyText(text: string) {
  if (!navigator.clipboard?.writeText) throw new Error('This browser won’t let Puddle use the clipboard. Export a file instead.');
  await navigator.clipboard.writeText(text);
}
