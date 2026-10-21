import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { accessLogTime, compilePattern, detectLogPreset, patternColumns, readLog } from './index';

const fixture = (name: string) => readFileSync(join(__dirname, '../../tests/fixtures/logs', name), 'utf8');
const lines = (name: string) => fixture(name).split('\n');

describe('reading a log file', () => {
  it('reads an access log in the combined format, the request split up, the time as a timestamp, dashes empty', () => {
    const t = readLog(fixture('access.log'), { preset: 'combined' });
    expect(t.columns).toEqual(['host', 'ident', 'user', 'time', 'method', 'path', 'protocol', 'status', 'bytes', 'referrer', 'agent']);
    expect(t.rows).toHaveLength(4);
    expect(t.unmatched).toBe(1);
    expect(t.rows[1]).toEqual(['203.0.113.7', '', 'kev', '2026-10-10 13:55:38+01:00', 'POST', '/api/orders', 'HTTP/1.1', '201', '512', '', 'curl/8.5.0']);
    expect(t.rows[2]!.slice(7, 9)).toEqual(['404', '']);
    // The common format, without the referrer and agent.
    expect(t.rows[3]!.slice(7)).toEqual(['304', '0', '', '']);
    expect(accessLogTime('1/Jan/2026:00:00:00')).toBe('2026-01-01 00:00:00');
    expect(accessLogTime('odd')).toBe('odd');
  });

  it('reads syslog lines, old style and RFC 5424 alike', () => {
    const t = readLog(fixture('syslog.log'), { preset: 'syslog' });
    expect(t.columns).toEqual(['priority', 'time', 'host', 'process', 'pid', 'id', 'data', 'message']);
    expect(t.rows).toEqual([
      ['', 'Oct 11 22:14:15', 'pi5', 'systemd', '1', '', '', 'Started Puddle runner.'],
      ['', 'Oct 11 22:14:16', 'pi5', 'puddle-run', '2048', '', '', 'Project "Taxi" started'],
      ['', 'Oct 11 22:14:19', 'pi5', 'kernel', '', '', '', 'usb 1-1: new high-speed USB device number 4'],
      ['34', '2026-10-11T22:14:20.123Z', 'pi5', 'puddle-run', '2048', 'ID47', '[meta seq="3"]', 'Output written: 3 rows'],
    ]);
    expect(t.unmatched).toBe(0);
  });

  it('reads an application log, levels in any dress, and joins a stack trace to the line above it', () => {
    const t = readLog(fixture('app.log'), { preset: 'timestamped' });
    expect(t.columns).toEqual(['time', 'level', 'message']);
    expect(t.rows).toEqual([
      ['2026-10-11 09:00:01,250', 'INFO', 'Puddle runner started'],
      ['2026-10-11 09:00:02.004', '', '[main] DEBUG Reading orders.csv'],
      ['2026-10-11T09:00:03Z', 'WARN', 'Column "qty" has 2 values that aren’t numbers'.replace('’', "'")],
      ['2026-10-11 09:00:04,000', 'ERROR', 'Output failed\nTraceback (most recent call last):\n  File "run.py", line 12, in <module>\nValueError: no rows'],
      ['2026-10-11 09:00:05', '', 'Finished with 1 error'],
    ]);
    expect(t.unmatched).toBe(0);
  });

  it('reads an IIS log by its #Fields line, and says when there is none', () => {
    const t = readLog(fixture('iis.log'), { preset: 'iis' });
    expect(t.columns).toEqual(['date', 'time', 's-ip', 'cs-method', 'cs-uri-stem', 'cs-uri-query', 's-port', 'cs-username', 'c-ip', 'sc-status', 'time-taken']);
    expect(t.rows[1]).toEqual(['2026-10-11', '00:00:02', '10.0.0.5', 'POST', '/api/orders', 'id=7', '443', 'kev', '203.0.113.7', '201', '120']);
    expect(t.rows).toHaveLength(3);
    expect(() => readLog('a b c\n', { preset: 'iis' })).toThrow('There is no #Fields: line naming the columns, as an IIS log has at the top.');
  });

  it('reads a custom pattern by its named groups, numbering unnamed ones, and says what is wrong with a pattern', () => {
    const t = readLog('a=1 b=x\na=2 b=y\nnope\n', { preset: 'custom', pattern: 'a=(?<a>\\d+) b=(?<b>\\w+)' });
    expect(t).toEqual({ columns: ['a', 'b'], rows: [['1', 'x'], ['2', 'y']], preset: 'custom', unmatched: 1 });
    expect(readLog('k: v\n', { preset: 'custom', pattern: '(\\w+): (\\w+)' })).toMatchObject({ columns: ['group1', 'group2'], rows: [['k', 'v']] });
    expect(patternColumns(/(?<a>x)(?:y)(z)\((?=q)[(]/)).toEqual(['a', 'group1']);
    expect(() => compilePattern('')).toThrow(/Enter a pattern/);
    expect(() => compilePattern('(')).toThrow(/isn’t a regular expression JavaScript accepts/);
    expect(() => compilePattern('abc')).toThrow(/has no groups/);
  });

  it('detects the preset from the first lines, and none for a CSV or a plain text', () => {
    expect(detectLogPreset(lines('access.log'))).toBe('combined');
    expect(detectLogPreset(lines('syslog.log'))).toBe('syslog');
    expect(detectLogPreset(lines('app.log'))).toBe('timestamped');
    expect(detectLogPreset(lines('iis.log'))).toBe('iis');
    expect(detectLogPreset(['time,level,message', '2026-10-11 09:00:01,INFO,started', '2026-10-11 09:00:02,WARN,slow'])).toBeUndefined();
    expect(detectLogPreset(['2026-10-11 09:00:01\tINFO\tstarted', '2026-10-11 09:00:02\tWARN\tslow'])).toBeUndefined();
    expect(detectLogPreset(['Dear Kev,', 'the figures are attached.'])).toBeUndefined();
    expect(detectLogPreset(['2026-10-11 09:00:01 started'])).toBeUndefined();
  });
});
