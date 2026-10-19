/** Fixtures shared by the Worker unit tests. Test tokens/values only; nothing here is a real secret. */
export const ADMIN = 'https://admin.mullnyphotos.cz';

export const goodEnv = (): Record<string, string> => ({
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_ANON_KEY: 'anon-test-key-value',
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_ACCESS_KEY_ID: 'access-key-id-value',
  R2_SECRET_ACCESS_KEY: 'secret-access-key-value',
  R2_BUCKET: 'mullnyphotos',
  R2_BACKUP_BUCKET: 'mullnyphotos-backup',
  R2_PUBLIC_BASE_URL: 'https://img.mullnyphotos.cz',
  PAGES_DEPLOY_HOOK_URL: 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/hook-secret',
  ALLOWED_ORIGINS: `${ADMIN},http://localhost:5173`,
});
