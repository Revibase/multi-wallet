import { IPermissions } from "../generated";

export const Permission = {
  InitiateTransaction: 1 << 0,
  VoteTransaction: 1 << 1,
  ExecuteTransaction: 1 << 2,
  IsDelegate: 1 << 3,
  IsPermanent: 1 << 4,
} as const;

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
