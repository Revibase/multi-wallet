import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes/index.js";
import { Struct } from "@solana/web3.js";
import BN from "bn.js";

export interface Secp256r1VerifyArgs {
  authData: string;
  clientDataJson: string;
  signature: string;
  slotNumber: string;
  slotHash: string;
}

const SECP256R1_PUBLIC_KEY_LENGTH = 33;

type Secp256r1KeyInitData = number | string | Uint8Array | Array<number>;

export class Secp256r1Key extends Struct {
  _bn: BN | undefined;
  constructor(value: Secp256r1KeyInitData) {
    super({});
    if (typeof value === "string") {
      // Assume base-58 encoding by default
      const decoded = bs58.decode(value);
      this.validateKeyLength(decoded);
      this._bn = new BN(decoded);
    } else if (value instanceof Uint8Array || Array.isArray(value)) {
      this.validateKeyLength(value);
      this._bn = new BN(value);
    } else if (typeof value === "number") {
      this._bn = new BN(value);
    } else {
      throw new Error("Invalid input type for Secp256r1Key");
    }

    if (this._bn.byteLength() > SECP256R1_PUBLIC_KEY_LENGTH) {
      throw new Error(`Invalid public key input`);
    }
  }

  validateKeyLength(key: Uint8Array | Array<number>) {
    if (key.length !== SECP256R1_PUBLIC_KEY_LENGTH) {
      throw new Error(
        `Invalid public key length, expected ${SECP256R1_PUBLIC_KEY_LENGTH} bytes but got ${key.length}`
      );
    }
  }

  toBase58() {
    return bs58.encode(this.toBytes());
  }

  toTruncatedBuffer() {
    const buf = this.toBuffer();
    return buf.subarray(1, buf.length);
  }

  toBuffer() {
    if (!this._bn) {
      throw new Error(`Invalid public key input`);
    }
    const buf = this._bn.toArrayLike(Buffer);
    if (buf.length === SECP256R1_PUBLIC_KEY_LENGTH) {
      return buf;
    }
    const zeroPad = Buffer.alloc(SECP256R1_PUBLIC_KEY_LENGTH);
    buf.copy(zeroPad, SECP256R1_PUBLIC_KEY_LENGTH - buf.length);
    return zeroPad;
  }

  toBytes() {
    const buf = this.toBuffer();
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  toString() {
    return this.toBase58();
  }

  toJSON() {
    return this.toBase58();
  }
}
