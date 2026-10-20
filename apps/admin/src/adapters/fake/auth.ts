import { ApiError, AuthError, type AuthPort, type AuthSession } from '../../ports';
import type { Core } from './core';

/** Accounts of the fake world. Fake values only; the real adapter never sees these. */
export const FAKE_ADMIN = {
  id: 'eeeeeeee-0000-4000-8000-000000000001',
  email: 'fotograf@example.test',
  password: 'fake-heslo-1',
  isAdmin: true,
} as const;
export const FAKE_OUTSIDER = {
  id: 'eeeeeeee-0000-4000-8000-000000000002',
  email: 'host@example.test',
  password: 'fake-heslo-2',
  isAdmin: false,
} as const;

const HOUR_MS = 3_600_000;

export function notifyAuthChange(core: Core): void {
  for (const fn of core.listeners) fn();
}

export function createFakeAuth(core: Core): AuthPort {
  const { state } = core;
  const toSession = (): AuthSession | null => {
    const s = state.session;
    if (!s || s.expired) return null;
    return { userId: s.user.id, email: s.user.email, accessToken: s.token, expiresAt: core.clock.now() + HOUR_MS };
  };

  return {
    async getSession() {
      core.guard('auth.getSession');
      return toSession();
    },
    async signIn(email, password) {
      core.guard('auth.signIn');
      const user = state.users.find((u) => u.email === email.trim().toLowerCase() && u.password === password);
      if (!user) throw new AuthError('INVALID_CREDENTIALS');
      state.session = { user, token: `fake-token-${++state.tokenCounter}`, expired: false };
      notifyAuthChange(core);
      return toSession()!;
    },
    async signOut() {
      core.guard('auth.signOut');
      state.session = null;
      notifyAuthChange(core);
    },
    async isAdmin() {
      core.guard('auth.isAdmin');
      const s = state.session;
      return !!s && !s.expired && s.user.isAdmin;
    },
    async requestPasswordReset() {
      core.guard('auth.requestPasswordReset');
    },
    onAuthChange(listener) {
      const fn = () => listener(toSession());
      core.listeners.add(fn);
      return () => {
        core.listeners.delete(fn);
      };
    },
    onPasswordRecovery(listener) {
      core.recovery.listeners.add(listener);
      if (core.recovery.pending) listener();
      return () => {
        core.recovery.listeners.delete(listener);
      };
    },
    async updatePassword(newPassword) {
      core.guard('auth.updatePassword');
      const s = state.session;
      if (!s || s.expired) throw new ApiError('UNAUTHENTICATED');
      if (newPassword.length < 8) throw new AuthError('WEAK_PASSWORD');
      s.user.password = newPassword;
      core.recovery.pending = false;
    },
  };
}
