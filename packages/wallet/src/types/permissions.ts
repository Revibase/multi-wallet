import type { IPermissions } from "../generated";

export const Permission = {
  InitiateTransaction: 1 << 0,
  VoteTransaction: 1 << 1,
  ExecuteTransaction: 1 << 2,
} as const;

export const PermanentMemberPermission: IPermission = 1 << 3;

export const TransactionManagerPermission: IPermission = 1 << 4;

export type IPermission = (typeof Permission)[keyof typeof Permission];

export class Permissions implements IPermissions {
  private constructor(readonly mask: number) {}

  static fromPermissions(permissions: IPermission[]) {
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

  static has(permissions: IPermissions, permission: IPermission) {
    return (permissions.mask & permission) === permission;
  }
}
