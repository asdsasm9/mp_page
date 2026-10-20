/** Sign-in. Real adapter: supabase-js with the anon key only; there is no sign-up anywhere. */

export interface AuthSession {
  userId: string;
  email: string;
  /** Sent as the Bearer token at call time; never logged. */
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface AuthPort {
  getSession(): Promise<AuthSession | null>;
  /** Throws AuthError (INVALID_CREDENTIALS, TOO_MANY_ATTEMPTS) or NetworkError. */
  signIn(email: string, password: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  /** UX-only check ("Tento účet nemá přístup do správy."); RLS and the Worker are the authority. */
  isAdmin(): Promise<boolean>;
  /** Always resolves for a well-formed request, whether or not the address exists (neutral text). */
  requestPasswordReset(email: string): Promise<void>;
  /** Fires on sign-in, sign-out and expiry. Returns the unsubscribe function. */
  onAuthChange(listener: (session: AuthSession | null) => void): () => void;
}
