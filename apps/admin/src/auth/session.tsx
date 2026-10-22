/**
 * Session context: who is signed in, the admin check, sign-out, the password-recovery state and the
 * "login expired" flow.
 *
 * Statuses: loading (reading the stored session), signedOut, recovery (arrived through the reset mail
 * link, a new password is due), ready (signed in and an admin), expired (was ready, the session ended:
 * the app stays mounted under a modal so form state and the queue survive) and error (the check could
 * not be made). Nothing here logs; tokens and addresses never leave the ports.
 */
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, type AuthSession } from '../ports';
import { usePorts } from '../ports-context';
import { storeReturnPath } from './returnPath';

export type SessionStatus = 'loading' | 'signedOut' | 'recovery' | 'ready' | 'expired' | 'error';
export type SignInResult = 'ok' | 'denied';
export type GoogleSignInResult = SignInResult | 'cancelled' | 'failed';

export interface SessionValue {
  status: SessionStatus;
  session: AuthSession | null;
  /** The last sign-in worked but the account is not an admin (it was signed out again). */
  denied: boolean;
  /** Why status is "error". */
  error: unknown;
  /** Throws AuthError or NetworkError; 'denied' when the account is not an admin. */
  signIn(email: string, password: string): Promise<SignInResult>;
  /**
   * Google sign-in. The return path is validated and kept in sessionStorage. With the real adapter the page is
   * left and this never resolves; with the fake one it resolves with the outcome. Throws NetworkError offline.
   */
  signInWithGoogle(options?: { returnTo?: string; loginHint?: string }): Promise<GoogleSignInResult>;
  /** Sets the new password of the recovery session, then runs the admin check. */
  completeRecovery(newPassword: string): Promise<SignInResult>;
  signOut(): Promise<void>;
  /** Repeats the start-up check after status "error". */
  retry(): void;
  /**
   * Runs a call with the session. When it answers 401 (or the session already ended) the expiry modal
   * opens, the call waits, and it is repeated once after a successful login. Rejects if the user signs out.
   */
  runAuthed<T>(action: () => Promise<T>): Promise<T>;
}

interface State {
  status: SessionStatus;
  session: AuthSession | null;
  denied: boolean;
  error: unknown;
}

interface Deferred {
  action: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'UNAUTHENTICATED';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { auth } = usePorts();
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>({ status: 'loading', session: null, denied: false, error: null });
  const [attempt, setAttempt] = useState(0);
  const statusRef = useRef<SessionStatus>('loading');
  const recoveryRef = useRef(false);
  const userIdRef = useRef<string | null>(null);
  const deferred = useRef<Deferred[]>([]);

  const apply = useCallback((next: Partial<State>) => {
    if (next.status !== undefined) statusRef.current = next.status;
    setState((previous) => ({ ...previous, ...next }));
  }, []);

  const rejectDeferred = useCallback(() => {
    for (const item of deferred.current.splice(0)) item.reject(new ApiError('UNAUTHENTICATED'));
  }, []);

  const flushDeferred = useCallback(() => {
    for (const item of deferred.current.splice(0)) item.action().then(item.resolve, item.reject);
  }, []);

  /** The UX-only admin check; a non-admin is signed out again at once. */
  const admit = useCallback(
    async (session: AuthSession): Promise<SignInResult> => {
      const admin = await auth.isAdmin();
      if (recoveryRef.current) return 'ok';
      if (!admin) {
        userIdRef.current = null;
        rejectDeferred();
        apply({ status: 'signedOut', session: null, denied: true, error: null });
        await auth.signOut().catch(() => undefined);
        queryClient.clear();
        return 'denied';
      }
      userIdRef.current = session.userId;
      apply({ status: 'ready', session, denied: false, error: null });
      return 'ok';
    },
    [auth, apply, rejectDeferred, queryClient],
  );

  // Password recovery arrives from the link in the reset mail.
  useEffect(
    () =>
      auth.onPasswordRecovery(() => {
        recoveryRef.current = true;
        apply({ status: 'recovery', denied: false });
      }),
    [auth, apply],
  );

  // The session ended while the app was in use (expiry, sign-out in another tab).
  useEffect(
    () =>
      auth.onAuthChange((session) => {
        if (session === null && statusRef.current === 'ready') apply({ status: 'expired' });
      }),
    [auth, apply],
  );

  // Start-up: read the stored session and check the account. Until then nothing else renders or fetches.
  useEffect(() => {
    let cancelled = false;
    apply({ status: 'loading', error: null });
    (async () => {
      try {
        const session = await auth.getSession();
        if (cancelled) return;
        if (recoveryRef.current) return apply({ status: 'recovery', session });
        if (!session) return apply({ status: 'signedOut', session: null });
        await admit(session);
      } catch (error) {
        if (cancelled) return;
        if (isUnauthenticated(error)) apply({ status: 'signedOut', session: null });
        else apply({ status: 'error', error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth, admit, apply, attempt]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      apply({ denied: false });
      const session = await auth.signIn(email, password);
      const wasExpired = statusRef.current === 'expired';
      if (wasExpired && userIdRef.current !== null && userIdRef.current !== session.userId) {
        // Somebody else signed in: the waiting actions were not theirs.
        rejectDeferred();
        queryClient.clear();
      }
      const result = await admit(session);
      if (result === 'ok' && wasExpired) flushDeferred();
      return result;
    },
    [auth, apply, admit, rejectDeferred, flushDeferred, queryClient],
  );

  const signInWithGoogle = useCallback(
    async (options: { returnTo?: string; loginHint?: string } = {}): Promise<GoogleSignInResult> => {
      apply({ denied: false });
      const returnTo = storeReturnPath(options.returnTo);
      const wasExpired = statusRef.current === 'expired';
      const previousUser = userIdRef.current;
      await auth.signInWithGoogle({ returnTo, ...(options.loginHint ? { loginHint: options.loginHint } : {}) });
      // Real adapter: the page has been left. Fake adapter: the chooser is done and the outcome is here.
      const callbackError = auth.takeCallbackError();
      if (callbackError === 'CANCELLED') return 'cancelled';
      if (callbackError === 'FAILED') return 'failed';
      if (callbackError === 'NOT_ALLOWED') {
        apply({ denied: true });
        return 'denied';
      }
      const session = await auth.getSession();
      if (!session) return 'failed';
      if (wasExpired && previousUser !== null && previousUser !== session.userId) {
        // Somebody else signed in: the waiting actions were not theirs.
        rejectDeferred();
        queryClient.clear();
      }
      const result = await admit(session);
      if (result === 'ok' && wasExpired) flushDeferred();
      return result;
    },
    [auth, apply, admit, rejectDeferred, flushDeferred, queryClient],
  );

  const completeRecovery = useCallback(
    async (newPassword: string): Promise<SignInResult> => {
      await auth.updatePassword(newPassword);
      recoveryRef.current = false;
      const session = await auth.getSession();
      if (!session) {
        apply({ status: 'signedOut', session: null });
        return 'ok';
      }
      return admit(session);
    },
    [auth, apply, admit],
  );

  const signOut = useCallback(async () => {
    userIdRef.current = null;
    recoveryRef.current = false;
    rejectDeferred();
    apply({ status: 'signedOut', session: null, denied: false });
    queryClient.clear();
    await auth.signOut().catch(() => undefined);
  }, [auth, apply, rejectDeferred, queryClient]);

  const runAuthed = useCallback(
    <T,>(action: () => Promise<T>): Promise<T> => {
      const wait = () =>
        new Promise<T>((resolve, reject) => {
          if (statusRef.current === 'signedOut') return reject(new ApiError('UNAUTHENTICATED'));
          deferred.current.push({ action, resolve: resolve as (value: unknown) => void, reject });
          if (statusRef.current === 'ready') apply({ status: 'expired' });
        });
      if (statusRef.current === 'expired') return wait();
      return action().catch((error: unknown) => (isUnauthenticated(error) ? wait() : Promise.reject(error)));
    },
    [apply],
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo<SessionValue>(
    () => ({ ...state, signIn, signInWithGoogle, completeRecovery, signOut, retry, runAuthed }),
    [state, signIn, signInWithGoogle, completeRecovery, signOut, retry, runAuthed],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}
