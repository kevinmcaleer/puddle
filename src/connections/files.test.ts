import { connectionFile, forgetConnectionFile, rememberConnectionFile, resetConnectionFiles, useConnectionFiles } from './files';

afterEach(() => resetConnectionFiles());

it('keeps a connection’s file for the tab and tells React which connections have one', () => {
  const f = new File(['x'], 'shop.sqlite');
  expect(connectionFile('c1')).toBeUndefined();
  rememberConnectionFile('c1', f);
  expect(connectionFile('c1')).toBe(f);
  expect(useConnectionFiles.getState().ids).toEqual(['c1']);
  forgetConnectionFile('c1');
  expect(connectionFile('c1')).toBeUndefined();
  expect(useConnectionFiles.getState().ids).toEqual([]);
});
