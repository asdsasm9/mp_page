import { resolve } from 'node:path';
import { build } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminEnv } from '../env';
import { AdapterUnavailableError } from '../ports';
import { FAKE_ADMIN } from './fake/auth';
import { FAKE_WORLD_MARKER } from './fake/marker';
import { loadPorts } from './select';

const env = (backend: 'real' | 'fake'): AdminEnv => ({
  backend,
  supabaseUrl: '',
  supabaseAnonKey: '',
  apiBaseUrl: '',
  imgBaseUrl: '',
  publicSiteUrl: '',
  r2UploadOrigin: '',
});

afterEach(() => vi.unstubAllEnvs());

describe('adapter selection', () => {
  it('real mode throws a Czech error until the real adapters exist', async () => {
    vi.stubEnv('VITE_BACKEND', '');
    const error = await loadPorts(env('real')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterUnavailableError);
    expect((error as Error).message).toMatch(/Připojení k serveru zatím není k dispozici/);
  });

  it('fake mode loads the fake world when the build allows it', async () => {
    vi.stubEnv('VITE_BACKEND', 'fake');
    const ports = await loadPorts(env('fake'));
    await expect(ports.api.getStorage()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await ports.auth.signIn(FAKE_ADMIN.email, FAKE_ADMIN.password);
    expect((await ports.api.getStorage()).photo_count).toBe(141);
    expect((globalThis as Record<string, unknown>)[FAKE_WORLD_MARKER]).toBeDefined();
  });

  it('fake mode is refused when the build is not a fake build', async () => {
    vi.stubEnv('VITE_BACKEND', '');
    await expect(loadPorts(env('fake'))).rejects.toBeInstanceOf(AdapterUnavailableError);
  });
});

describe('production bundle', () => {
  const root = resolve(import.meta.dirname, '../..');

  /** Bundles the app entry in memory (no HTML, no files written) and returns all emitted code. */
  async function bundle(define: Record<string, string>): Promise<string> {
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      envFile: false,
      define,
      build: { write: false, lib: { entry: 'src/main.tsx', formats: ['es'], fileName: 'out' } },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as { output: { type: string; code?: string }[] }[];
    return outputs
      .flatMap((o) => o.output)
      .map((chunk) => chunk.code ?? '')
      .join('\n');
  }

  it('contains no fake world marker when VITE_BACKEND is unset, and does contain it for a fake build', async () => {
    const saved = process.env.VITE_BACKEND;
    delete process.env.VITE_BACKEND;
    try {
      const prod = await bundle({});
      expect(prod.length).toBeGreaterThan(1000);
      expect(prod).not.toContain(FAKE_WORLD_MARKER);
      expect(prod).not.toContain('FAKE_WORLD_CONTRACT_VIOLATION');
      const fake = await bundle({ 'import.meta.env.VITE_BACKEND': '"fake"' });
      expect(fake).toContain(FAKE_WORLD_MARKER);
    } finally {
      if (saved !== undefined) process.env.VITE_BACKEND = saved;
    }
  }, 90_000);
});
