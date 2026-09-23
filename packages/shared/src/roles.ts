/**
 * Rollen- und Berechtigungsmodell.
 *
 * Grundsatz: Jede Rolle erhält ausschliesslich die Rechte, die sie benötigt
 * (Least Privilege). Die Sichtbarkeit von Daten wird zusätzlich über den
 * "Scope" gesteuert (alle Immobilien der Organisation, freigeschaltete
 * Immobilien oder nur eigene Mieterdaten).
 */

export const ROLES = [
  'SUPER_ADMIN',
  'OWNER',
  'MANAGER',
  'EMPLOYEE',
  'CARETAKER',
  'TENANT',
  'SERVICE_PROVIDER',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  OWNER: 'Eigentümer',
  MANAGER: 'Verwalter',
  EMPLOYEE: 'Mitarbeiter',
  CARETAKER: 'Hauswart',
  TENANT: 'Mieter',
  SERVICE_PROVIDER: 'Handwerker / Dienstleister',
};

export const PERMISSIONS = [
  'dashboard:read',
  'property:read',
  'property:write',
  'unit:read',
  'unit:write',
  'tenant:read',
  'tenant:write',
  'lease:read',
  'lease:write',
  'finance:read',
  'finance:write',
  'payment:import',
  'payment:post',
  'expense:read',
  'expense:write',
  'damage:read',
  'damage:write',
  'damage:assign',
  'document:read',
  'document:read_financial',
  'document:write',
  'message:read',
  'message:write',
  'task:read',
  'task:write',
  'appointment:read',
  'appointment:write',
  'announcement:write',
  'report:read',
  'excel:sync',
  'automation:manage',
  'provider:read',
  'provider:write',
  'user:manage',
  'settings:manage',
  'audit:read',
  'portal:access',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = PERMISSIONS.filter((p) => p !== 'portal:access');

const MANAGER_PERMS: Permission[] = ALL.filter((p) => p !== 'settings:manage');

const EMPLOYEE_PERMS: Permission[] = [
  'dashboard:read',
  'property:read',
  'unit:read',
  'tenant:read',
  'tenant:write',
  'lease:read',
  'finance:read',
  'payment:import',
  'expense:read',
  'expense:write',
  'damage:read',
  'damage:write',
  'damage:assign',
  'document:read',
  'document:read_financial',
  'document:write',
  'message:read',
  'message:write',
  'task:read',
  'task:write',
  'appointment:read',
  'appointment:write',
  'report:read',
  'provider:read',
];

/** Hauswart: operative Arbeit an Mängeln, keinerlei Finanzdaten. */
const CARETAKER_PERMS: Permission[] = [
  'dashboard:read',
  'property:read',
  'unit:read',
  'damage:read',
  'damage:write',
  'document:read',
  'document:write',
  'message:read',
  'message:write',
  'task:read',
  'task:write',
  'appointment:read',
  'appointment:write',
  'provider:read',
];

/** Mieter: ausschliesslich Mieterportal – der Scope beschränkt auf eigene Daten. */
const TENANT_PERMS: Permission[] = ['portal:access'];

/** Dienstleister: nur zugewiesene Tickets. */
const PROVIDER_PERMS: Permission[] = [
  'damage:read',
  'document:read',
  'damage:write',
  'message:read',
  'message:write',
  'appointment:read',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: ALL,
  OWNER: ALL,
  MANAGER: MANAGER_PERMS,
  EMPLOYEE: EMPLOYEE_PERMS,
  CARETAKER: CARETAKER_PERMS,
  TENANT: TENANT_PERMS,
  SERVICE_PROVIDER: PROVIDER_PERMS,
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Datenumfang einer Rolle:
 * - ORGANIZATION: alle Immobilien der eigenen Organisation
 * - ASSIGNED_PROPERTIES: nur explizit freigeschaltete Immobilien
 * - OWN_TENANCY: nur eigene Mietverhältnisse (Mieter)
 * - ASSIGNED_TICKETS: nur zugewiesene Mängel (Dienstleister)
 */
export type DataScope = 'ORGANIZATION' | 'ASSIGNED_PROPERTIES' | 'OWN_TENANCY' | 'ASSIGNED_TICKETS';

export const ROLE_SCOPE: Record<Role, DataScope> = {
  SUPER_ADMIN: 'ORGANIZATION',
  OWNER: 'ORGANIZATION',
  MANAGER: 'ORGANIZATION',
  EMPLOYEE: 'ASSIGNED_PROPERTIES',
  CARETAKER: 'ASSIGNED_PROPERTIES',
  TENANT: 'OWN_TENANCY',
  SERVICE_PROVIDER: 'ASSIGNED_TICKETS',
};

export const STAFF_ROLES: Role[] = ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'EMPLOYEE', 'CARETAKER'];

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}
