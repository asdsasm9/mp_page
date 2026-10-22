import { type AuthPort, type AuthSession } from '../../ports';
import type { Core } from './core';

/** Accounts of the fake world. Fake values only; the real adapter never sees these. */
export const FAKE_ADMIN = {
  id: 'eeeeeeee-0000-4000-8000-000000000001',
  email: 'fotograf@example.test',
  isAdmin: true,
} as const;
export const FAKE_OUTSIDER = {
  id: 'eeeeeeee-0000-4000-8000-000000000002',
  email: 'host@example.test',
  isAdmin: false,
} as const;

const HOUR_MS = 3_600_000;

/** Manual fake mode: `?fake-google=outsider|cancel` picks the fake chooser's answer. Read here and nowhere else. */
function queryChoice(): 'outsider' | 'cancel' | null {
  const search = typeof location === 'undefined' ? '' : location.search;
  const value = new URLSearchParams(search).get('fake-google');
  return value === 'outsider' || value === 'cancel' ? value : null;
}

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
    async signInWithGoogle() {
      core.guard('auth.signInWithGoogle');
      const choice = state.google.next ?? queryChoice() ?? 'admin';
      state.google.next = null;
      state.google.callbackError = null;
      if (choice === 'cancel') {
        state.google.callbackError = 'CANCELLED';
        return;
      }
      const user = choice.includes('@')
        ? state.users.find((u) => u.email === choice.toLowerCase())
        : state.users.find((u) => u.isAdmin === (choice === 'admin'));
      if (!user) {
        state.google.callbackError = 'FAILED';
        return;
      }
      state.session = { user, token: `fake-token-${++state.tokenCounter}`, expired: false };
      notifyAuthChange(core);
    },
    takeCallbackError() {
      const error = state.google.callbackError;
      state.google.callbackError = null;
      return error;
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
    onAuthChange(listener) {
      const fn = () => listener(toSession());
      core.listeners.add(fn);
      return () => {
        core.listeners.delete(fn);
      };
    },
  };
}
