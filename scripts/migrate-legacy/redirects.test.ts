// Plan item 12: the dry-run redirect file carries the ids a live (fake) run commits, line for line.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { main } from '../migrate-legacy';
import { createFakeBackend } from './fake-backend';
import { redirectLine } from './planner';
import { tempReportDir } from './report-dir.helper';

const BASE = 'https://img.example.test';
const env = { SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_ANON_KEY: 'k', API_BASE_URL: 'https://api.example.test', MIGRATE_ADMIN_EMAIL: 'a@example.test', MIGRATE_ADMIN_PASSWORD: 'pw' };

let tiny: Buffer;
beforeAll(async () => {
  tiny = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#336699' } }).jpeg().toBuffer();
});

describe('redirect file vs live run', () => {
  it('has the ids committed in a live fake run, and its lines equal those built from the live rows', async () => {
    const dryDir = tempReportDir('mig-red-');
    expect(await main([], () => {}, () => {}, { plan: { exists: () => true, read: async () => tiny, publicImgBaseUrl: BASE }, reportDir: dryDir })).toBe(0);
    const dryLines = readFileSync(join(dryDir, 'legacy-image-redirects.txt'), 'utf8').trimEnd().split('\n');
    expect(dryLines).toHaveLength(141);

    const b = createFakeBackend();
    const upload = { exists: () => true, read: async () => tiny, sleep: async () => {} };
    expect(await main(['--live', '--confirm-project', 'abcdefgh'], () => {}, () => {}, { env, backend: b, upload, reportDir: tempReportDir('mig-red-') })).toBe(0);
    const rows = b.photos();
    expect(rows).toHaveLength(141);

    // Ids: same set, and each dry-run line points at the id stored for that legacy key.
    const idByKey = new Map(rows.map((p) => [p.legacy_key!, p.id] as const));
    const dryIds = dryLines.map((l) => /\/photos\/([0-9a-f-]{36})\/1600\.jpg/.exec(l)![1]!);
    expect(new Set(dryIds).size).toBe(141);
    expect([...dryIds].sort()).toEqual(rows.map((p) => p.id).sort());
    for (const line of dryLines) {
      const key = line.split(' ')[0]!.replace('/fotky_web/galleries/', '');
      expect(line).toBe(redirectLine(key, idByKey.get(key)!, BASE));
    }
  }, 60_000);
});
