/**
 * Role-based access control.
 *
 * Authorization is ALWAYS enforced server-side by middleware. The UI only uses
 * these to adapt what it renders — hiding a button is not a security control.
 *
 * Roles (least privilege, most restrictive first):
 *   GUEST        – unauthenticated visitors (only when guest access is enabled)
 *   VIEWER       – read-only dashboard
 *   OPERATOR     – approved operational actions (restart/stop containers…)
 *   ADMIN        – administrative management, no irreversible super-admin ops
 *   SUPER_ADMIN  – everything, including recovery/emergency controls
 */

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'GUEST';

export type Permission =
  | 'dashboard.view'
  | 'dashboard.configure'
  | 'servers.view'
  | 'servers.manage'
  | 'containers.view'
  | 'containers.manage'
  | 'vms.view'
  | 'vms.manage'
  | 'services.view'
  | 'services.manage'
  | 'notifications.view'
  | 'notifications.manage'
  | 'logs.view'
  | 'users.view'
  | 'users.manage'
  | 'settings.view'
  | 'settings.manage'
  | 'integrations.view'
  | 'integrations.manage'
  | 'backups.view'
  | 'backups.manage'
  | 'system.view'
  | 'system.manage'
  | 'recovery.manage'
  | 'audit.view';

export const ROLES: Role[] = ['GUEST', 'VIEWER', 'OPERATOR', 'ADMIN', 'SUPER_ADMIN'];

/** Immutable role → permission grants. SUPER_ADMIN/ADMIN use '*' wildcards. */
const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  GUEST: [
    'dashboard.view',
    'servers.view',
    'containers.view',
    'vms.view',
    'services.view',
    'notifications.view',
  ],
  VIEWER: [
    'dashboard.view',
    'servers.view',
    'containers.view',
    'vms.view',
    'services.view',
    'notifications.view',
    'logs.view',
  ],
  OPERATOR: [
    'dashboard.view',
    'servers.view',
    'servers.manage',
    'containers.view',
    'containers.manage',
    'vms.view',
    'vms.manage',
    'services.view',
    'services.manage',
    'notifications.view',
    'logs.view',
  ],
  ADMIN: ['*'],
  SUPER_ADMIN: ['*'],
};

/** Guest permissions are further filtered by the administrator's guest scope. */
export const GUEST_SCOPES: Record<string, Permission> = {
  serverStatus: 'servers.view',
  serviceStatus: 'services.view',
  containers: 'containers.view',
  vms: 'vms.view',
  cpu: 'dashboard.view',
  ram: 'dashboard.view',
  storage: 'dashboard.view',
  uptime: 'dashboard.view',
  ipAddresses: 'servers.view',
  logs: 'logs.view',
  notifications: 'notifications.view',
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  const grants = ROLE_PERMISSIONS[role];
  if (grants.includes('*')) return true;
  return (grants as readonly Permission[]).includes(permission);
}

/**
 * Effective permissions for a role. Guests are further restricted by the
 * administrator-configured guest scope (see `guestPermissionsFor`).
 */
export function permissionsForRole(role: Role): Permission[] {
  const grants = ROLE_PERMISSIONS[role];
  if (grants.includes('*')) return ALL_PERMISSIONS;
  return [...(grants as readonly Permission[])];
}

export const ALL_PERMISSIONS: Permission[] = [
  'dashboard.view',
  'dashboard.configure',
  'servers.view',
  'servers.manage',
  'containers.view',
  'containers.manage',
  'vms.view',
  'vms.manage',
  'services.view',
  'services.manage',
  'notifications.view',
  'notifications.manage',
  'logs.view',
  'users.view',
  'users.manage',
  'settings.view',
  'settings.manage',
  'integrations.view',
  'integrations.manage',
  'backups.view',
  'backups.manage',
  'system.view',
  'system.manage',
  'recovery.manage',
  'audit.view',
];

/**
 * Permissions for an unauthenticated GUEST given the enabled guest scopes.
 * Each enabled scope grants exactly the read-only permission(s) listed in
 * GUEST_SCOPES — guests never inherit dashboard/operational permissions.
 */
export function guestPermissionsFor(scopes: string[]): Permission[] {
  const set = new Set<Permission>();
  for (const scope of scopes) {
    const permission = GUEST_SCOPES[scope];
    if (permission) set.add(permission);
  }
  return [...set];
}
