import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfigError } from './ConfigError';
import { parseEnv } from './env';

const full = {
  VITE_SUPABASE_URL: 'https://x.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon',
  VITE_API_BASE_URL: 'https://api.example.com/',
  VITE_IMG_BASE_URL: 'https://img.example.com',
  VITE_PUBLIC_SITE_URL: 'https://site.example.com',
  VITE_R2_UPLOAD_ORIGIN: 'https://r2.example.com',
};

describe('parseEnv', () => {
  it('rejects missing VITE_SUPABASE_URL in real mode', () => {
    const { VITE_SUPABASE_URL: _omit, ...rest } = full;
    const r = parseEnv({ ...rest, VITE_BACKEND: 'real' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join()).toContain('VITE_SUPABASE_URL');
  });

  it('defaults to real mode when VITE_BACKEND is unset', () => {
    expect(parseEnv({}).ok).toBe(false);
  });

  it('accepts fake mode with nothing else', () => {
    const r = parseEnv({ VITE_BACKEND: 'fake' });
    expect(r.ok && r.env.backend).toBe('fake');
  });

  it('accepts a full real config and trims trailing slashes', () => {
    const r = parseEnv({ ...full, VITE_BACKEND: 'real' });
    expect(r.ok && r.env.apiBaseUrl).toBe('https://api.example.com');
  });

  it('rejects invalid URLs and unknown backend', () => {
    expect(parseEnv({ ...full, VITE_API_BASE_URL: 'nope' }).ok).toBe(false);
    expect(parseEnv({ ...full, VITE_BACKEND: 'x' }).ok).toBe(false);
  });

  it('never echoes values in problems', () => {
    const r = parseEnv({ ...full, VITE_API_BASE_URL: 'secret-value' });
    expect(JSON.stringify(r)).not.toContain('secret-value');
  });
});

describe('ConfigError', () => {
  it('shows a Czech heading and the problem names', () => {
    render(<ConfigError problems={['VITE_SUPABASE_URL (chybí)']} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Správa není nastavená');
    expect(screen.getByText('VITE_SUPABASE_URL (chybí)')).toBeTruthy();
  });
});
