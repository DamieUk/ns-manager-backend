export const ROLES = ['executive', 'manager', 'employee'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSION_KEYS = ['ORDERS', 'USERS', 'PRODUCTS'] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_ACTIONS = ['none', 'view', 'modify'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export interface Permission {
  key: PermissionKey;
  action: PermissionAction;
}

export const ACTION_RANK: Record<PermissionAction, number> = {
  none: 0,
  view: 1,
  modify: 2,
};

export const ROLE_DEFAULT_PERMISSIONS: Record<Role, Permission[]> = {
  executive: [
    { key: 'ORDERS', action: 'modify' },
    { key: 'USERS', action: 'modify' },
    { key: 'PRODUCTS', action: 'modify' },
  ],
  manager: [
    { key: 'USERS', action: 'modify' },
    { key: 'PRODUCTS', action: 'modify' },
  ],
  employee: [{ key: 'PRODUCTS', action: 'view' }],
};

export function canManageRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === 'executive') return true;
  if (actorRole === 'manager') return targetRole === 'employee';
  return false;
}
