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
  signOut(): Promise<void>;
  /** UX-only check ("Tento účet nemá přístup do správy."); RLS and the Worker are the authority. */
  isAdmin(): Promise<boolean>;
  /** Fires on sign-in, sign-out and expiry. Returns the unsubscribe function. */
  onAuthChange(listener: (session: AuthSession | null) => void): () => void;
}
