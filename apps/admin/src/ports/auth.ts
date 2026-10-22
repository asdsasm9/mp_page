/** Sign-in. Real adapter: supabase-js with the anon key only; there is no sign-up anywhere. */

export interface AuthSession {
  userId: string;
  email: string;
  /** Sent as the Bearer token at call time; never logged. */
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** Why the last Google round trip failed; read once through `takeCallbackError`. */
export type CallbackError = 'CANCELLED' | 'NOT_ALLOWED' | 'FAILED';

export interface GoogleSignInOptions {
  /** App path to return to after sign-in; already validated by the caller (see auth/returnPath.ts). */
  returnTo: string;
  /** Pre-selects the account in the Google chooser (expiry re-sign-in). */
  loginHint?: string;
}

export interface AuthPort {
  getSession(): Promise<AuthSession | null>;
  /**
   * Starts the Google sign-in. Real adapter: leaves the page (full-page redirect) and does not come back.
   * Fake adapter: resolves once the fake chooser is done. Throws NetworkError when offline.
   */
  signInWithGoogle(options: GoogleSignInOptions): Promise<void>;
  /** The error of the last Google round trip, once; null when there is none. */
  takeCallbackError(): CallbackError | null;
  /** Throws AuthError (INVALID_CREDENTIALS, TOO_MANY_ATTEMPTS) or NetworkError. */
  signIn(email: string, password: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  /** UX-only check ("Tento účet nemá přístup do správy."); RLS and the Worker are the authority. */
  isAdmin(): Promise<boolean>;
  /** Always resolves for a well-formed request, whether or not the address exists (neutral text). */
  requestPasswordReset(email: string): Promise<void>;
  /** Fires on sign-in, sign-out and expiry. Returns the unsubscribe function. */
  onAuthChange(listener: (session: AuthSession | null) => void): () => void;
  /**
   * The user arrived through the reset-mail link and holds a short recovery session: the app must show the
   * "set a new password" form. The listener is also called at once when that already happened before it subscribed.
   */
  onPasswordRecovery(listener: () => void): () => void;
  /** Sets the password of the signed-in (recovery) session. Throws AuthError WEAK_PASSWORD or NetworkError. */
  updatePassword(newPassword: string): Promise<void>;
}
