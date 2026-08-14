export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'GUEST';

export const ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER', 'GUEST'];

export type Permission = string;

export interface PublicUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  twoFactorEnabled: boolean;
  email: string | null;
  emailOtpEnabled: boolean;
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

export interface Modes {
  readOnly: boolean;
  emergencyLock: boolean;
  safeMode: boolean;
  guest: boolean;
}

export interface SessionInfo {
  id: string;
  csrf?: string;
  tokenSet?: boolean;
}

export interface MeResponse {
  user: PublicUser;
  permissions: Permission[];
  modes: Modes;
  session: SessionInfo;
}

export type TwoFactorMethod = 'totp' | 'email' | 'question';

export interface LoginResponse {
  user: PublicUser;
  permissions: Permission[];
  modes: Modes;
  session?: SessionInfo;
  twoFactorRequired?: boolean;
  twoFactorToken?: string;
  twoFactorMethods?: TwoFactorMethod[];
  username?: string;
}

export interface RecoveryStatus {
  questionsConfigured: boolean;
  email: string | null;
  emailOtpEnabled: boolean;
  smtpConfigured: boolean;
}

export type SettingsMap = Record<string, string>;

export interface SettingsResponse {
  settings: SettingsMap;
  writable: string[];
}

export interface FeatureStatus {
  id: string;
  label: string;
  description: string;
  group: 'infrastructure' | 'integrations' | 'notifications' | 'platform';
  enabled: boolean;
  supported: boolean;
}

export interface BackupMeta {
  id: string;
  type: 'manual' | 'daily' | 'weekly' | 'monthly';
  file: string;
  size: number;
  createdAt: number;
  status: 'ok' | 'failed';
  note: string | null;
}

export interface BackupStatus {
  enabled: boolean;
  hour: number;
  minute: number;
  retention: { daily: number; weekly: number; monthly: number };
  lastRun: string | null;
}

export interface SnapshotMeta {
  id: string;
  name: string;
  note: string | null;
  createdAt: number;
  createdBy: string | null;
}

export type IntegrationKind = 'uptime_kuma' | 'telegram' | 'email' | 'prometheus' | 'ai_assistant';

export interface IntegrationPublic {
  id: string;
  name: string;
  kind: IntegrationKind;
  enabled: boolean;
  configured: boolean;
  config: Record<string, unknown> | null;
  secretFields: string[];
  status: string;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  updatedAt: number;
}

export interface IntegrationKindsMap {
  [kind: string]: { secretFields: string[] };
}

export interface IntegrationsResponse {
  integrations: IntegrationPublic[];
  kinds: IntegrationKindsMap;
  featureMap: Record<string, boolean>;
}

export interface AuditEntry {
  ts: number;
  user_id?: string | null;
  username?: string | null;
  role?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  action: string;
  target?: string | null;
  result: 'success' | 'failure' | 'denied';
  details?: string | null;
}

export interface AuditResponse {
  items: AuditEntry[];
  total: number;
}

export interface SecurityHealth {
  users: number;
  admins: number;
  sessions: number;
  twoFactorAdoption: number;
  passwordPolicy: { minLength: number; requireSymbol: boolean };
  modes: Modes;
  auditEnabled: boolean;
  guestAccess: boolean;
  lastBackup: { createdAt: number; type: string; status: string } | null;
  features: Record<string, boolean>;
}

export interface UserSession {
  id: string;
  ip: string | null;
  user_agent: string | null;
  created_at: number;
  last_active_at: number;
  expires_at: number;
  revoked: number;
}
