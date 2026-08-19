import { api } from './client';
import type {
  AuditResponse,
  BackupMeta,
  BackupStatus,
  FeatureStatus,
  IntegrationsResponse,
  IntegrationPublic,
  LoginResponse,
  MeResponse,
  PublicUser,
  SecurityHealth,
  SettingsResponse,
  SnapshotMeta,
  UserSession,
} from '@/types/auth';
import type {
  BootStats,
  ClusterInfo,
  GlobalHealth,
  HistoryPoint,
  HistoryRange,
  NetworkTopology,
  Notification,
  QuickAction,
  QuickStat,
  SearchResults,
  ServerRuntime,
  StatsHistoryPoint,
} from '@/types';

export const endpoints = {
  ping: () => api.get<{ pong: true; ts: number }>('/ping'),

  health: () =>
    api.get<{
      status: string;
      mockMode: boolean;
      provider: string;
      lastPollError: string | null;
      diagnostics: {
        lastPollAt: number | null;
        lastPollError: string | null;
        endpointErrors: Record<string, string>;
      } | null;
      bootStats: BootStats;
      timestamp: number;
    }>('/health'),

  servers: {
    list: () => api.get<ServerRuntime[]>('/servers'),
    detail: (id: string) => api.get<ServerRuntime>(`/servers/${id}`),
    history: (id: string, range: HistoryRange) =>
      api.get<{ serverId: string; range: HistoryRange; points: HistoryPoint[] }>(
        `/servers/${id}/history?range=${range}`,
      ),
  },

  globalHealth: () => api.get<GlobalHealth>('/health/global'),
  clusters: () => api.get<{ clusters: ClusterInfo[] }>('/clusters'),
  stats: () => api.get<QuickStat[]>('/stats'),
  statsHistory: (range: HistoryRange) =>
    api.get<{ range: HistoryRange; points: StatsHistoryPoint[] }>(`/stats/history?range=${range}`),
  network: () => api.get<NetworkTopology>('/network'),

  notifications: {
    list: (limit = 30) => api.get<Notification[]>(`/notifications?limit=${limit}`),
    unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),
    read: (ids: string[]) => api.post<{ ok: true; count: number }>('/notifications/read', { ids }),
    readAll: () => api.post<{ ok: true }>('/notifications/read-all'),
  },

  search: (q: string) => api.get<SearchResults>(`/search?q=${encodeURIComponent(q)}`),

  quickActions: {
    list: () => api.get<QuickAction[]>('/quick-actions'),
  },

  docker: {
    containers: () => api.get<{ containers: Array<{ id: string; name: string; running: boolean; image: string; ports?: string[] }> }>('/docker/containers'),
    hosts: () => api.get<{ profiles: Array<{ hostName: string; hostIp: string; netDownMbps: number; netUpMbps: number; containers: Array<{ id: string; name: string; running: boolean; image: string; ports?: string[] }> }> }>('/docker/hosts'),
  },

  auth: {
    me: () => api.get<MeResponse>('/auth/me'),
    login: (body: {
      username: string;
      password: string;
      twoFactorToken?: string;
      twoFactorCode?: string;
      twoFactorMethod?: string;
    }) => api.post<LoginResponse>('/auth/login', body),
    logout: () => api.post<{ ok: true }>('/auth/logout'),
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      api.post<{ ok: true }>('/auth/change-password', body),
    sessions: () => api.get<{ sessions: UserSession[] }>('/auth/sessions'),
    terminateSession: (id: string) => api.post<{ ok: true }>(`/auth/sessions/${id}/terminate`),
    terminateAll: () => api.post<{ ok: true; revoked: number }>('/auth/sessions/terminate-all'),
    twoFactorSetup: (body: { password: string }) =>
      api.post<{ secret: string; recoveryCodes: string[]; otpauth: string }>('/auth/2fa/setup', body),
    twoFactorVerify: (body: { code: string }) => api.post<{ ok: true }>('/auth/2fa/verify-setup', body),
    twoFactorDisable: (body: { password: string }) => api.post<{ ok: true }>('/auth/2fa/disable', body),
    twoFactorRegenerate: (body: { password: string }) =>
      api.post<{ secret: string; recoveryCodes: string[] }>('/auth/2fa/regenerate-recovery', body),

    twoFactorSendEmail: (body: { twoFactorToken: string }) =>
      api.post<{ ok: true; resentAfterSec: number }>('/auth/2fa/email/send', body),
    twoFactorQuestion: (body: { twoFactorToken: string }) =>
      api.post<{ question: string }>('/auth/2fa/question', body),

    emailOtpEnable: (body: { password: string; email: string }) => api.post<{ ok: true }>('/auth/2fa/email/enable', body),
    emailOtpDisable: (body: { password: string }) => api.post<{ ok: true }>('/auth/2fa/email/disable', body),

    securityQuestionsSetup: (body: { password: string; questions: Array<{ question: string; answer: string }> }) =>
      api.post<{ ok: true }>('/auth/security-questions/setup', body),
    securityQuestionsClear: (body: { password: string }) => api.post<{ ok: true }>('/auth/security-questions/clear', body),

    recoveryStatus: () =>
      api.get<{
        questionsConfigured: boolean;
        email: string | null;
        emailOtpEnabled: boolean;
        smtpConfigured: boolean;
      }>('/auth/recovery/status'),
    recoveryOptions: (username: string) =>
      api.get<{ methods: string[] }>(`/auth/recovery/options?username=${encodeURIComponent(username)}`),
    recoveryStart: (body: { username: string }) =>
      api.post<{
        recoveryToken: string | null;
        methods: string[];
        questions: string[];
        emailMasked?: string | null;
      }>('/auth/recovery/start', body),
    recoveryQuestions: (body: { recoveryToken: string; answers: string[] }) =>
      api.post<{ resetToken: string }>('/auth/recovery/questions', body),
    recoveryEmail: (body: { recoveryToken: string }) =>
      api.post<{ ok: true; resentAfterSec: number }>('/auth/recovery/email', body),
    recoveryEmailVerify: (body: { recoveryToken: string; code: string }) =>
      api.post<{ resetToken: string }>('/auth/recovery/email-verify', body),
    recoveryReset: (body: { resetToken: string; newPassword: string }) =>
      api.post<{ ok: true }>('/auth/recovery/reset', body),
  },

  admin: {
    mode: () => api.get<{ readOnly: boolean; emergencyLock: boolean; safeMode: boolean; guest: boolean }>('/admin/mode'),

    settings: {
      get: () => api.get<SettingsResponse>('/admin/settings'),
      update: (settings: Record<string, string | number | boolean | string[]>) =>
        api.put<{ ok: true; applied: string[]; invalid: string[] }>('/admin/settings', { settings }),
    },

    features: {
      list: () => api.get<{ features: FeatureStatus[] }>('/admin/features'),
      set: (id: string, enabled: boolean) =>
        api.put<{ ok: true; feature: { id: string; enabled: boolean } }>(`/admin/features/${id}`, { enabled }),
    },

    quickActions: {
      list: () => api.get<QuickAction[]>('/admin/quick-actions'),
      save: (actions: QuickAction[]) =>
        api.put<{ ok: true; actions: QuickAction[] }>('/admin/quick-actions', { actions }),
    },

    users: {
      list: () => api.get<{ users: PublicUser[]; roles: string[] }>('/admin/users'),
      create: (body: {
        username: string;
        name?: string;
        password: string;
        role: string;
        mustChangePassword?: boolean;
        email?: string;
      }) => api.post<{ user: PublicUser }>('/admin/users', body),
      update: (id: string, body: Record<string, unknown>) =>
        api.put<{ user: PublicUser }>(`/admin/users/${id}`, body),
      remove: (id: string) => api.delete<{ ok: true }>(`/admin/users/${id}`),
    },

    audit: {
      list: (params: { page?: number; perPage?: number; search?: string; action?: string; result?: string } = {}) => {
        const qs = new URLSearchParams();
        if (params.page) qs.set('page', String(params.page));
        if (params.perPage) qs.set('perPage', String(params.perPage));
        if (params.search) qs.set('search', params.search);
        if (params.action) qs.set('action', params.action);
        if (params.result) qs.set('result', params.result);
        const query = qs.toString();
        return api.get<AuditResponse>(`/admin/audit${query ? `?${query}` : ''}`);
      },
      actions: () => api.get<{ actions: string[] }>('/admin/audit/actions'),
    },

    securityHealth: () => api.get<SecurityHealth>('/admin/security-health'),

    snapshots: {
      list: () => api.get<{ snapshots: SnapshotMeta[] }>('/admin/snapshots'),
      create: (body: { name?: string; note?: string }) =>
        api.post<{ snapshot: SnapshotMeta }>('/admin/snapshots', body),
      restore: (id: string) =>
        api.post<{ ok: true; integrationsRestored: number }>(`/admin/snapshots/${id}/restore`),
      remove: (id: string) => api.delete<{ ok: true }>(`/admin/snapshots/${id}`),
    },

    integrations: {
      list: () => api.get<IntegrationsResponse>('/admin/integrations'),
      create: (body: {
        name: string;
        kind: string;
        enabled?: boolean;
        config?: Record<string, unknown>;
        secrets?: Record<string, string>;
      }) => api.post<{ integration: IntegrationPublic }>('/admin/integrations', body),
      update: (id: string, body: Record<string, unknown>) =>
        api.put<{ integration: IntegrationPublic }>(`/admin/integrations/${id}`, body),
      remove: (id: string) => api.delete<{ ok: true }>(`/admin/integrations/${id}`),
      test: (id: string) =>
        api.post<{ ok: boolean; latencyMs?: number; error?: string }>(`/admin/integrations/${id}/test`),
    },

    backups: {
      list: () => api.get<{ backups: BackupMeta[]; status: BackupStatus }>('/admin/backups'),
      create: (note?: string) => api.post<{ backup: BackupMeta }>('/admin/backups', { note }),
      remove: (id: string) => api.delete<{ ok: true }>(`/admin/backups/${id}`),
      restore: (id: string) =>
        api.post<{ restored: boolean; message: string }>(`/admin/backups/${id}/restore`),
    },

    emergency: {
      lock: () => api.post<{ ok: true; revoked: number }>('/admin/lock'),
      unlock: (password: string) => api.post<{ ok: true }>('/admin/unlock', { password }),
      safeMode: (enabled: boolean) => api.post<{ ok: true; enabled: boolean }>('/admin/safe-mode', { enabled }),
    },
  },
};
