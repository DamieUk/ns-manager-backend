// executive — the company's owners (shown as «Власник»): full access, approve requests.
// employee — workshop staff: their assigned orders, reports and requests.
export const ROLES = ['executive', 'employee'] as const;
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
  employee: [{ key: 'PRODUCTS', action: 'view' }],
};

export function canManageRole(actorRole: Role, targetRole: Role): boolean {
  return actorRole === 'executive' && ROLES.includes(targetRole);
}
