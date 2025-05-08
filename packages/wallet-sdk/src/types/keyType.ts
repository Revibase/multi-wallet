export type IKeyType = {
  keyType: number;
};

export const KeyType = {
  Ed25519: 1 << 0,
  Secp256r1: 1 << 1,
} as const;

export type KeyType = (typeof KeyType)[keyof typeof KeyType];
