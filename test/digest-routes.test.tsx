import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

// Route tests for /digest/:night and /api/digest/:night. The runs dir is a temp dir written
// in beforeAll; runs/ itself is read-only and never touched here.
let dir = '';
const savedMarker = process.env.LANE_MARKER;

const config = () => ({
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: dir,
});

const lines = (...objs: object[]) => `${objs.map((o) => JSON.stringify(o)).join('\n')}\n`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));

  // Lines are written out of job order on purpose: the rows must come back sorted.
  writeFileSync(
    join(dir, '2026-10-28.jsonl'),
    lines(
      { at: '2026-10-28T01:00:00+01:00', job: 'notes/backup', status: 'ok', owner: 'lane' },
      { at: '2026-10-28T01:05:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' },
      { at: '2026-10-28T01:06:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' },
      { at: '2026-10-28T01:07:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' },
      { at: '2026-10-28T01:08:00+01:00', job: 'fixtures/refresh', status: 'ok', owner: 'rook' },
      { at: '2026-10-28T02:00:00+01:00', job: 'digest/render', status: 'ok', owner: null },
      { at: '2026-10-28T02:10:00+01:00', job: 'lane/sync', status: 'ok', owner: 'lane' },
      { at: '2026-10-28T03:00:00+01:00', job: 'notes/backup', status: 'fail', owner: 'lane', error: 'quota exceeded' },
    ),
  );

  writeFileSync(join(dir, '2026-10-29.jsonl'), '');

  writeFileSync(
    join(dir, '2026-10-30.jsonl'),
    [
      JSON.stringify({ at: '2026-10-30T01:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'lane' }),
      '{"at":"2026-10-30T02:00:00+01:00","job":"digest/rend',
      JSON.stringify({ at: '2026-10-30T03:00:00+01:00', job: 'digest/render', status: 'ok', owner: null }),
      '',
    ].join('\n'),
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  if (savedMarker === undefined) delete process.env.LANE_MARKER;
  else process.env.LANE_MARKER = savedMarker;
});

describe('normal night 2026-10-28', () => {
  it('answers 200 on both routes', async () => {
    const app = createApp(config());
    const page = await app.request('/digest/2026-10-28');
    const api = await app.request('/api/digest/2026-10-28');
    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
  });

  it('JSON rows are sorted by job, with retries, status and error kept', async () => {
    const res = await createApp(config()).request('/api/digest/2026-10-28');
    const body = await res.json();
    expect(body.night).toBe('2026-10-28');
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r: { job: string }) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
    ]);
    expect(body.rows[1]).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-28T01:05:00+01:00',
      lastAt: '2026-10-28T01:08:00+01:00',
    });
    expect(body.rows[3]).toMatchObject({ job: 'notes/backup', lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('page contains every job, and a null owner as a dash', async () => {
    const res = await createApp(config()).request('/digest/2026-10-28');
    const html = await res.text();
    for (const job of ['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup']) {
      expect(html).toContain(`<td>${job}</td>`);
    }
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('<td class="warn">3</td>');
    expect(html).toContain('<td class="warn">fail</td>');
  });

  it('page lists jobs in the same order as the JSON', async () => {
    const app = createApp(config());
    const html = await (await app.request('/digest/2026-10-28')).text();
    const api = await (await app.request('/api/digest/2026-10-28')).json();
    const positions = api.rows.map((r: { job: string }) => html.indexOf(`<td>${r.job}</td>`));
    expect(positions.every((p: number) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe('night with no file 2026-11-01', () => {
  it('answers 404 on both routes', async () => {
    const app = createApp(config());
    const page = await app.request('/digest/2026-11-01');
    const api = await app.request('/api/digest/2026-11-01');
    expect(page.status).toBe(404);
    expect(api.status).toBe(404);
    expect(await page.text()).toContain('no digest for this night');
    expect(await api.json()).toEqual({ error: 'no such night', night: '2026-11-01' });
  });
});

describe('empty night 2026-10-29', () => {
  it('page says nothing ran', async () => {
    const res = await createApp(config()).request('/digest/2026-10-29');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('JSON has no rows and no bad lines', async () => {
    const res = await createApp(config()).request('/api/digest/2026-10-29');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: '2026-10-29', rows: [], badLines: 0 });
  });
});

describe('night with a bad line 2026-10-30', () => {
  it('JSON counts the bad line and still returns the good rows', async () => {
    const res = await createApp(config()).request('/api/digest/2026-10-30');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r: { job: string }) => r.job)).toEqual(['digest/render', 'lane/sync']);
  });

  it('page still renders the rows and notes the bad line', async () => {
    const res = await createApp(config()).request('/digest/2026-10-30');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<td>digest/render</td>');
    expect(html).toContain('<td>lane/sync</td>');
    expect(html).toContain('1 line could not be read');
  });
});

describe('lane banner on the digest page', () => {
  it('shows LANE_MARKER in the HTML', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const res = await createApp(config()).request('/digest/2026-10-28');
    expect(await res.text()).toContain('TEST-MARKER');
  });
});
