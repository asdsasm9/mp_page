export type Backend = 'real' | 'fake';

export interface AdminEnv {
  backend: Backend;
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBaseUrl: string;
  imgBaseUrl: string;
  publicSiteUrl: string;
  r2UploadOrigin: string;
}

export type EnvResult =
  | { ok: true; env: AdminEnv }
  | { ok: false; problems: string[] };

export const CONFIG_ERROR_TEXT = {
  title: 'Správa není nastavená',
  intro: 'Aplikace nemá úplné nastavení, a proto se nemůže spustit. Obraťte se na správce webu.',
  detailsLabel: 'Podrobnosti',
} as const;

type Raw = Record<string, string | undefined>;

const URL_NAMES = [
  ['VITE_SUPABASE_URL', 'supabaseUrl'],
  ['VITE_API_BASE_URL', 'apiBaseUrl'],
  ['VITE_IMG_BASE_URL', 'imgBaseUrl'],
  ['VITE_PUBLIC_SITE_URL', 'publicSiteUrl'],
  ['VITE_R2_UPLOAD_ORIGIN', 'r2UploadOrigin'],
] as const;

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Validates build-time env. Fake mode needs nothing else. Real mode needs every
 * name below; only variable names are reported, never values.
 */
export function parseEnv(raw: Raw): EnvResult {
  const backendRaw = (raw.VITE_BACKEND ?? '').trim();
  if (backendRaw !== '' && backendRaw !== 'real' && backendRaw !== 'fake') {
    return { ok: false, problems: ['VITE_BACKEND (povoleno: real, fake)'] };
  }
  const backend: Backend = backendRaw === 'fake' ? 'fake' : 'real';
  const get = (name: string) => (raw[name] ?? '').trim();

  if (backend === 'fake') {
    return {
      ok: true,
      env: {
        backend,
        supabaseUrl: get('VITE_SUPABASE_URL'),
        supabaseAnonKey: get('VITE_SUPABASE_ANON_KEY'),
        apiBaseUrl: get('VITE_API_BASE_URL'),
        imgBaseUrl: get('VITE_IMG_BASE_URL'),
        publicSiteUrl: get('VITE_PUBLIC_SITE_URL'),
        r2UploadOrigin: get('VITE_R2_UPLOAD_ORIGIN'),
      },
    };
  }

  const problems: string[] = [];
  const out: Record<string, string> = {};
  for (const [name, key] of URL_NAMES) {
    const v = get(name);
    if (v === '') problems.push(`${name} (chybí)`);
    else if (!isHttpUrl(v)) problems.push(`${name} (není platná adresa)`);
    else out[key] = v.replace(/\/+$/, '');
  }
  const anon = get('VITE_SUPABASE_ANON_KEY');
  if (anon === '') problems.push('VITE_SUPABASE_ANON_KEY (chybí)');
  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    env: {
      backend,
      supabaseUrl: out.supabaseUrl!,
      supabaseAnonKey: anon,
      apiBaseUrl: out.apiBaseUrl!,
      imgBaseUrl: out.imgBaseUrl!,
      publicSiteUrl: out.publicSiteUrl!,
      r2UploadOrigin: out.r2UploadOrigin!,
    },
  };
}

export function readEnv(): EnvResult {
  return parseEnv(import.meta.env as unknown as Raw);
}
