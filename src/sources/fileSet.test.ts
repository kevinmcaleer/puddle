import { setFilesOf, setFormat } from './fileSet';

const file = (name: string, relative?: string) => {
  const f = new File(['x'], name);
  if (relative) Object.defineProperty(f, 'webkitRelativePath', { value: relative });
  return f;
};

describe('choosing a file set', () => {
  it('names files by their path inside a chosen folder, the folder’s own name left off, in natural order', () => {
    const picked = setFilesOf([file('b10.parquet', 'extract/2024/b10.parquet'), file('b9.parquet', 'extract/2024/b9.parquet'), file('a.parquet', 'extract/a.parquet')]);
    expect(picked.folder).toBe('extract');
    expect(picked.files.map((f) => f.name)).toEqual(['2024/b9.parquet', '2024/b10.parquet', 'a.parquet']);
  });

  it('names files chosen one by one by their own names, with no folder', () => {
    const picked = setFilesOf([file('b.csv'), file('a.csv')]);
    expect(picked).toEqual({ files: [expect.objectContaining({ name: 'a.csv' }), expect.objectContaining({ name: 'b.csv' })], folder: undefined });
  });

  it('reads the kind most of the files are, leaving out the others and hidden files', () => {
    const { files } = setFilesOf([file('a.parquet'), file('b.parquet'), file('notes.csv'), file('.hidden.parquet'), file('readme.md')]);
    const found = setFormat(files);
    expect(found?.format).toBe('parquet');
    expect(found?.files.map((f) => f.name)).toEqual(['a.parquet', 'b.parquet']);
    expect(setFormat(setFilesOf([file('readme.md')]).files)).toBeUndefined();
  });
});
