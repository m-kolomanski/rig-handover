import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const tmp = mkdtempSync(join(tmpdir(), 'rig-digest-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('reads 5 jobs, sorted, and counts 1 bad line', () => {
    expect(night).not.toBeNull();
    expect(night?.night).toBe('2026-10-28');
    expect(night?.badLines).toBe(1);
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('keeps the last error after a later ok run', () => {
    const row = night?.rows.find((r) => r.job === 'fixtures/refresh');
    expect(row).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('keeps a row whose owner is null', () => {
    const row = night?.rows.find((r) => r.job === 'digest/render');
    expect(row?.owner).toBeNull();
    expect(row?.lastError).toBeNull();
  });

  it('records a fail', () => {
    const row = night?.rows.find((r) => r.job === 'notes/backup');
    expect(row?.lastStatus).toBe('fail');
    expect(row?.lastError).toBe('quota exceeded');
  });
});

describe('readNight edge cases', () => {
  it('returns null for a night with no file', () => {
    expect(readNight('runs', '1999-01-01')).toBeNull();
  });

  it('returns null for a night that is not YYYY-MM-DD', () => {
    expect(readNight('runs', '../package')).toBeNull();
    expect(readNight('runs', '2026-10-28.jsonl')).toBeNull();
    expect(readNight('runs', '')).toBeNull();
  });

  it('reads an empty file as a night with no rows', () => {
    writeFileSync(join(tmp, '2026-01-01.jsonl'), '');
    expect(readNight(tmp, '2026-01-01')).toEqual({ night: '2026-01-01', rows: [], badLines: 0 });
  });

  it('counts invalid lines, skips blank ones, and takes the last owner', () => {
    const lines = [
      '{"at":"2026-01-02T01:00:00+01:00","job":"a","status":"ok","owner":"x"}',
      '',
      '{"at":"2026-01-02T02:00:00+01:00","job":"a","status":"retry","owner":null}',
      '{"at":"2026-01-02T03:00:00+01:00","job":"b","status":"bogus","owner":null}',
      '{"job":"b","status":"ok","owner":null}',
      '{"at":"2026-01-02T03:00:00+01:00","job":"b","status":"ok","owner":7}',
      '[1,2]',
      'not json',
    ];
    writeFileSync(join(tmp, '2026-01-02.jsonl'), `${lines.join('\n')}\n`);
    const night = readNight(tmp, '2026-01-02');
    expect(night?.badLines).toBe(5);
    expect(night?.rows).toEqual([
      {
        job: 'a',
        owner: null,
        runs: 2,
        retries: 1,
        lastStatus: 'retry',
        lastError: null,
        firstAt: '2026-01-02T01:00:00+01:00',
        lastAt: '2026-01-02T02:00:00+01:00',
      },
    ]);
  });
});
