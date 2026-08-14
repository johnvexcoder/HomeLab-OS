import { create } from 'zustand';
import { endpoints } from '@/api/endpoints';
import { setCsrfToken } from '@/api/client';
import { ApiError } from '@/api/client';
import type { LoginResponse, MeResponse, Modes, Permission, PublicUser, TwoFactorMethod } from '@/types/auth';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface LoginResult {
  ok: boolean;
  twoFactorRequired?: boolean;
  twoFactorToken?: string;
  twoFactorMethods?: TwoFactorMethod[];
  error?: string;
}

interface AuthState {
  status: AuthStatus;
  user: PublicUser | null;
  permissions: Permission[];
  modes: Modes | null;
  csrf: string | null;

  bootstrap: () => Promise<void>;
  login: (
    username: string,
    password: string,
    twoFactorToken?: string,
    twoFactorCode?: string,
    twoFactorMethod?: TwoFactorMethod,
  ) => Promise<LoginResult>;
  logout: () => Promise<void>;
  setSession: (data: MeResponse) => void;
  clear: () => void;
  has: (permission: Permission) => boolean;
}

function applySession(state: AuthState, data: MeResponse): void {
  state.user = data.user;
  state.permissions = data.permissions;
  state.modes = data.modes;
  state.csrf = data.session?.csrf ?? state.csrf;
  state.status = 'authenticated';
  setCsrfToken(state.csrf);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  permissions: [],
  modes: null,
  csrf: null,

  bootstrap: async () => {
    try {
      const data = await endpoints.auth.me();
      const state = get();
      applySession(state, data);
      set({ ...state });
    } catch {
      set({ status: 'anonymous', user: null, permissions: [], modes: null, csrf: null });
      setCsrfToken(null);
    }
  },

  login: async (username, password, twoFactorToken, twoFactorCode, twoFactorMethod) => {
    try {
      const data = await endpoints.auth.login({
        username,
        password,
        twoFactorToken: twoFactorToken ?? undefined,
        twoFactorCode: twoFactorCode ?? undefined,
        twoFactorMethod: twoFactorMethod ?? undefined,
      });
      if (data.twoFactorRequired) {
        return { ok: false, twoFactorRequired: true, twoFactorToken: data.twoFactorToken, twoFactorMethods: data.twoFactorMethods };
      }
      const state = get();
      applySession(state, data as MeResponse);
      set({ ...state });
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'server_unreachable';
      return { ok: false, error: message };
    }
  },

  logout: async () => {
    try {
      await endpoints.auth.logout();
    } catch {
      /* ignore network errors on logout */
    }
    get().clear();
  },

  setSession: (data) => {
    const state = get();
    applySession(state, data);
    set({ ...state });
  },

  clear: () => {
    set({ status: 'anonymous', user: null, permissions: [], modes: null, csrf: null });
    setCsrfToken(null);
  },

  has: (permission) => {
    const { permissions, user } = get();
    if (user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN') return true;
    return permissions.includes(permission);
  },
}));
