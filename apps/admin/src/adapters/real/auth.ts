/**
 * Real AuthPort over supabase-js. Anon key only; email + password; there is no registration anywhere.
 * The session lives in supabase-js' own localStorage entry and refreshes itself (autoRefreshToken).
 * Nothing in this file logs: tokens, e-mail addresses and passwords are never written to any output.
 */
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { ApiError, AuthError, NetworkError, type AuthPort, type AuthSession } from '../../ports';

/** The error shape supabase-js returns (AuthApiError, AuthRetryableFetchError, ...). */
export interface SupabaseErrorLike {
  name?: string;
  status?: number;
  code?: string;
}

/** The part of `supabase.auth` this adapter uses; tests pass a stub. */
export interface SupabaseAuthLike {
  getSession(): Promise<{ data: { session: Session | null }; error: SupabaseErrorLike | null }>;
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<{ data: { session: Session | null }; error: SupabaseErrorLike | null }>;
  signOut(options?: { scope: 'global' | 'local' | 'others' }): Promise<{ error: SupabaseErrorLike | null }>;
  resetPasswordForEmail(email: string, options?: { redirectTo?: string }): Promise<{ error: SupabaseErrorLike | null }>;
  updateUser(attributes: { password: string }): Promise<{ error: SupabaseErrorLike | null }>;
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
}

const isTransport = (e: SupabaseErrorLike): boolean =>
  e.name === 'AuthRetryableFetchError' || e.status === 0 || e.status === undefined;

/** Maps a supabase-js failure to the port's vocabulary. */
function failure(e: SupabaseErrorLike, kind: 'credentials' | 'password'): Error {
  if (isTransport(e)) return new NetworkError();
  if (e.status === 429 || e.code === 'over_request_rate_limit') return new AuthError('TOO_MANY_ATTEMPTS');
  if ((e.status ?? 0) >= 500) return new ApiError('UPSTREAM_ERROR', { status: e.status ?? 502 });
  if (kind === 'password') return new AuthError('WEAK_PASSWORD');
  return new AuthError('INVALID_CREDENTIALS');
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

export interface RealAuthOptions {
  /** Is this user in the admins table (own row only, under the user's JWT)? Throws on transport errors. */
  isAdminUser(userId: string): Promise<boolean>;
  /** Where the reset mail leads back to. */
  redirectTo?: string;
}

export function createRealAuth(auth: SupabaseAuthLike, options: RealAuthOptions): AuthPort {
  const changeListeners = new Set<(session: AuthSession | null) => void>();
  const recoveryListeners = new Set<() => void>();
  let recoveryPending = false;
  let recoveryNotified = new WeakSet<() => void>();
  const notifyRecovery = (fn: () => void) => {
    if (recoveryNotified.has(fn)) return;
    recoveryNotified.add(fn);
    fn();
  };

  // One subscription for the adapter's lifetime. Listeners run on a later tick: supabase-js holds its auth
  // lock while a callback runs, and the app's listeners call back into it.
  auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      recoveryPending = true;
      recoveryNotified = new WeakSet();
      setTimeout(() => [...recoveryListeners].forEach(notifyRecovery), 0);
      return;
    }
    if (event === 'SIGNED_OUT') {
      recoveryPending = false;
      setTimeout(() => [...changeListeners].forEach((fn) => fn(null)), 0);
    } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      const mapped = toAuthSession(session);
      setTimeout(() => [...changeListeners].forEach((fn) => fn(mapped)), 0);
    }
  });

  const currentSession = async (): Promise<AuthSession | null> => {
    const { data, error } = await auth.getSession();
    if (error && isTransport(error)) throw new NetworkError();
    return toAuthSession(data.session);
  };

  return {
    getSession: currentSession,
    // TEMPORARY (T-230): the real Google flow is task T-231.
    async signInWithGoogle() {
      throw new Error('signInWithGoogle is not implemented in the real adapter yet (T-231)');
    },
    takeCallbackError() {
      throw new Error('takeCallbackError is not implemented in the real adapter yet (T-231)');
    },
    async signIn(email, password) {
      const { data, error } = await auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw failure(error, 'credentials');
      const session = toAuthSession(data.session);
      if (!session) throw new AuthError('INVALID_CREDENTIALS');
      return session;
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
    async requestPasswordReset(email) {
      const { error } = await auth.resetPasswordForEmail(email.trim(), {
        ...(options.redirectTo === undefined ? {} : { redirectTo: options.redirectTo }),
      });
      // The answer must not reveal whether the address exists: only a missing connection is reported.
      if (error && isTransport(error)) throw new NetworkError();
    },
    onAuthChange(listener) {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },
    onPasswordRecovery(listener) {
      recoveryListeners.add(listener);
      if (recoveryPending) setTimeout(() => notifyRecovery(listener), 0);
      return () => {
        recoveryListeners.delete(listener);
      };
    },
    async updatePassword(newPassword) {
      const { error } = await auth.updateUser({ password: newPassword });
      if (error) throw failure(error, 'password');
      recoveryPending = false;
    },
  };
}
