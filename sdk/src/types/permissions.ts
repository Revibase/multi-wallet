export type IPermissions = {
  mask: number;
};

export const Permission = {
  InitiateTransaction: 1 << 0,
  VoteTransaction: 1 << 1,
  ExecuteTransaction: 1 << 2,
  IsDelegate: 1 << 3,
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export class Permissions implements IPermissions {
  private constructor(readonly mask: number) {}

  static fromPermissions(permissions: Permission[]) {
    return new Permissions(
      permissions.reduce((mask, permission) => mask | permission, 0)
    );
  }

  static all() {
    return new Permissions(
      Object.values(Permission).reduce(
        (mask, permission) => mask | permission,
        0
      )
    );
  }

  static has(permissions: IPermissions, permission: Permission) {
    return (permissions.mask & permission) === permission;
  }
}
