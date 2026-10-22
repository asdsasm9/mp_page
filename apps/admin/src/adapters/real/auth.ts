/**
 * Real AuthPort over supabase-js. Anon key only; Google sign-in (PKCE); there is no registration anywhere.
 * The session lives in supabase-js' own localStorage entry and refreshes itself (autoRefreshToken).
 * Nothing in this file logs: tokens, e-mail addresses and codes are never written to any output.
 *
 * Findings from the pinned @supabase/supabase-js / auth-js 2.117.2 (read from node_modules, no network):
 * - The default flowType is 'implicit'. It must be set to 'pkce' explicitly (adapters/real/index.ts); with
 *   'implicit' a callback `?code=` is not exchanged, and with 'pkce' an implicit `#access_token` URL is refused.
 * - signInWithOAuth builds `<supabase>/auth/v1/authorize?provider&redirect_to&scopes?&code_challenge&
 *   code_challenge_method&<queryParams>` and, in a browser, navigates there (window.location.assign) unless
 *   skipBrowserRedirect. The PKCE verifier is stored in localStorage (same origin and browser must return).
 *   `scopes` is only sent when given: we never give it, so Google gets openid/email/profile defaults only.
 *   queryParams are appended verbatim: only `prompt` and (when known) `login_hint` are allowed here.
 * - On start-up (detectSessionInUrl) auth-js merges the hash and then the query (query wins) and treats `error`,
 *   `error_code` or `error_description` as a failed callback. It does NOT remove them from the URL and it does
 *   not expose them to the app (initialize() just returns an error without a status, which this file would
 *   otherwise read as a transport failure). So this adapter reads and removes them itself, synchronously when
 *   it is created, which is right after createClient and before auth-js looks at the URL (its start-up is async).
 * - On a successful PKCE exchange auth-js removes `code` (and its flow id) from the URL itself and fires
 *   SIGNED_IN. A failed exchange (missing verifier, other browser) keeps `code` in the URL; not handled here.
 * - Error redirects look like `?error=access_denied&error_code=signup_disabled&error_description=...`; a user
 *   cancelling at Google gives `error=access_denied` without a sign-up code. The English description is never
 *   shown nor logged; only the codes are mapped (see mapCallbackError).
 * - The "return path" is owned by auth/returnPath.ts (sessionStorage, written by the session layer before this
 *   adapter is called), so `returnTo` is deliberately ignored here: one owner.
 */
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import {
  ApiError,
  AuthError,
  NetworkError,
  type AuthPort,
  type AuthSession,
  type CallbackError,
  type GoogleSignInOptions,
} from '../../ports';

/** The error shape supabase-js returns (AuthApiError, AuthRetryableFetchError, ...). */
export interface SupabaseErrorLike {
  name?: string;
  status?: number;
  code?: string;
}

/** The part of `supabase.auth` this adapter uses; tests pass a stub. */
export interface SupabaseAuthLike {
  getSession(): Promise<{ data: { session: Session | null }; error: SupabaseErrorLike | null }>;
  signInWithOAuth(credentials: {
    provider: 'google';
    options: { redirectTo: string; queryParams: Record<string, string> };
  }): Promise<{ data: unknown; error: SupabaseErrorLike | null }>;
  signOut(options?: { scope: 'global' | 'local' | 'others' }): Promise<{ error: SupabaseErrorLike | null }>;
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
}

const isTransport = (e: SupabaseErrorLike): boolean =>
  e.name === 'AuthRetryableFetchError' || e.status === 0 || e.status === undefined;

/** Maps a supabase-js failure to the port's vocabulary. */
function failure(e: SupabaseErrorLike): Error {
  if (isTransport(e)) return new NetworkError();
  if (e.status === 429 || e.code === 'over_request_rate_limit') return new AuthError('TOO_MANY_ATTEMPTS');
  return new ApiError('UPSTREAM_ERROR', { status: e.status ?? 502 });
}

export function toAuthSession(session: Session | null): AuthSession | null {
  if (!session) return null;
  return {
    userId: session.user.id,
    email: session.user.email ?? '',
    accessToken: session.access_token,
    expiresAt: (session.expires_at ?? 0) * 1000,
  };
}

const CALLBACK_PARAMS = ['error', 'error_code', 'error_description'] as const;

/** Sign-up refused or account not usable: the Google account is simply not allowed in. */
const NOT_ALLOWED_CODES = new Set([
  'signup_disabled',
  'user_banned',
  'email_address_not_authorized',
  'provider_email_needs_verification',
  'email_not_confirmed',
]);

/** Maps the callback's codes (never the English description) to the port's vocabulary. */
export function mapCallbackError(error: string | undefined, errorCode: string | undefined): CallbackError {
  if (errorCode !== undefined && NOT_ALLOWED_CODES.has(errorCode)) return 'NOT_ALLOWED';
  if (error === 'access_denied') return 'CANCELLED';
  return 'FAILED';
}

/**
 * Reads `error`, `error_code`, `error_description` from the query and the hash (query wins, like auth-js),
 * removes just those parameters from the address bar with history.replaceState and returns the mapped error.
 * Returns null, and touches nothing, when the URL carries none of them.
 */
export function consumeCallbackError(): CallbackError | null {
  if (typeof location === 'undefined') return null;
  let url: URL;
  try {
    url = new URL(location.href);
  } catch {
    return null;
  }
  const hash = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : '');
  const found = new Map<string, string>();
  for (const name of CALLBACK_PARAMS) {
    const value = url.searchParams.get(name) ?? hash.get(name);
    if (value !== null) found.set(name, value);
  }
  if (found.size === 0) return null;
  for (const name of CALLBACK_PARAMS) {
    url.searchParams.delete(name);
    hash.delete(name);
  }
  const rest = hash.toString();
  url.hash = rest;
  try {
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  } catch {
    // Address bar not writable: the error is still reported once.
  }
  return mapCallbackError(found.get('error'), found.get('error_code'));
}

export interface RealAuthOptions {
  /** Is the signed-in user an admin (the `is_admin` RPC under the user's JWT)? Throws on transport errors. */
  isAdminUser(userId: string): Promise<boolean>;
  /** The one redirect URL registered with Supabase: origin + '/prihlaseni'. */
  redirectTo?: string;
}

export function createRealAuth(auth: SupabaseAuthLike, options: RealAuthOptions): AuthPort {
  const changeListeners = new Set<(session: AuthSession | null) => void>();

  // One subscription for the adapter's lifetime. Listeners run on a later tick: supabase-js holds its auth
  // lock while a callback runs, and the app's listeners call back into it.
  auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      setTimeout(() => [...changeListeners].forEach((fn) => fn(null)), 0);
    } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      const mapped = toAuthSession(session);
      setTimeout(() => [...changeListeners].forEach((fn) => fn(mapped)), 0);
    }
  });

  // Read once, now: auth-js leaves these parameters in the URL and gives the app no way to see them.
  let callbackError: CallbackError | null = consumeCallbackError();

  const currentSession = async (): Promise<AuthSession | null> => {
    const { data, error } = await auth.getSession();
    if (error && isTransport(error)) throw new NetworkError();
    return toAuthSession(data.session);
  };

  return {
    getSession: currentSession,
    async signInWithGoogle(google: GoogleSignInOptions) {
      // returnTo is already stored by the session layer (auth/returnPath.ts); not repeated here.
      const redirectTo = options.redirectTo ?? `${location.origin}/prihlaseni`;
      const queryParams: Record<string, string> = { prompt: 'select_account' };
      if (google.loginHint) queryParams.login_hint = google.loginHint;
      // No `scopes`: Google gets the defaults (openid, email, profile). In a browser this leaves the page.
      const { error } = await auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams } });
      if (error) throw failure(error);
    },
    takeCallbackError() {
      const taken = callbackError;
      callbackError = null;
      return taken;
    },
    async signOut() {
      const { error } = await auth.signOut();
      // Whatever happened on the network, this browser must forget the session.
      if (error) await auth.signOut({ scope: 'local' });
    },
    async isAdmin() {
      const session = await currentSession();
      return session ? options.isAdminUser(session.userId) : false;
    },
    onAuthChange(listener) {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },
  };
}
