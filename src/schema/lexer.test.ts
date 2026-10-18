import { blockString, lex } from './lexer';

describe('lex', () => {
  const kinds = (text: string) => lex(text).tokens.map((t) => `${t.kind}:${t.value}`);

  it('reads names, strings, expressions, colours, numbers and operators', () => {
    expect(kinds('a "b c" \'d\' `e()` #fff 1.5e3 <> < > - ? ~')).toEqual([
      'ident:a',
      'quoted:b c',
      'string:d',
      'expr:e()',
      'color:#fff',
      'number:1.5e3',
      'op:<>',
      'op:<',
      'op:>',
      'op:-',
      'punct:?',
      'punct:~',
      'eof:',
    ]);
  });

  it('reads a word that starts with a digit as a name', () => {
    expect(kinds('2fa 12')).toEqual(['ident:2fa', 'number:12', 'eof:']);
  });

  it('drops comments but keeps the lines they span', () => {
    expect(kinds('a // b\n/* c\nd */ e')).toEqual(['ident:a', 'newline:\n', 'newline:\n', 'ident:e', 'eof:']);
  });

  it('unescapes strings', () => {
    expect(lex("'it\\'s \\\\ here'").tokens[0]!.value).toBe("it's \\ here");
    expect(lex('"a \\" b"').tokens[0]!.value).toBe('a " b');
  });

  it('reports what is never closed', () => {
    expect(lex("'open").errors.map((e) => e.message)).toEqual(["This string is never closed with '"]);
    expect(lex('`open').errors.map((e) => e.message)).toEqual(['This expression is never closed with `']);
    expect(lex("'''open").errors.map((e) => e.message)).toEqual(["This multi-line string is never closed with '''"]);
    expect(lex('a ^ b').errors.map((e) => e.message)).toEqual(['Unexpected character "^"']);
  });
});

describe('blockString', () => {
  it('removes the indent its lines share and the blank first and last lines', () => {
    expect(blockString('\n    a\n      b\n\n    c\n  ')).toBe('a\n  b\n\nc');
  });

  it('joins continued lines and applies escapes', () => {
    expect(blockString('\n  one \\\n  two \\\\ \\\'three\\\'\n')).toBe("one two \\ 'three'");
  });
});
