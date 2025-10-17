import { getBase58Decoder, getBase58Encoder } from "gill";
import type { ParsedAuthenticationResponse } from "./passkeys";

const SECP256R1_PUBLIC_KEY_LENGTH = 33;

type Secp256r1KeyInitData = string | Uint8Array | Array<number>;

export class Secp256r1Key {
  _bn: Uint8Array | undefined;
  verifyArgs: ParsedAuthenticationResponse["verifyArgs"] | undefined;
  domainConfig: ParsedAuthenticationResponse["domainConfig"] | undefined;
  authData: ParsedAuthenticationResponse["authData"] | undefined;
  signature: ParsedAuthenticationResponse["signature"] | undefined;
  constructor(
    value: Secp256r1KeyInitData,
    additionalInfo?: Omit<ParsedAuthenticationResponse, "signer">
  ) {
    if (typeof value === "string") {
      // Assume base-58 encoding by default
      const decoded = new Uint8Array(getBase58Encoder().encode(value));
      this.validateKeyLength(decoded);
      this._bn = decoded;
    } else if (value instanceof Uint8Array || Array.isArray(value)) {
      this.validateKeyLength(value);
      this._bn = new Uint8Array(value);
    } else {
      throw new Error("Invalid input type for Secp256r1Key");
    }

    if (this._bn.byteLength > SECP256R1_PUBLIC_KEY_LENGTH) {
      throw new Error(`Invalid public key input`);
    }

    this.verifyArgs = additionalInfo?.verifyArgs;
    this.domainConfig = additionalInfo?.domainConfig;
    this.authData = additionalInfo?.authData;
    this.signature = additionalInfo?.signature;
  }

  validateKeyLength(key: Uint8Array | Array<number>) {
    if (key.length !== SECP256R1_PUBLIC_KEY_LENGTH) {
      throw new Error(
        `Invalid public key length, expected ${SECP256R1_PUBLIC_KEY_LENGTH} bytes but got ${key.length}`
      );
    }
  }

  toBase58() {
    return getBase58Decoder().decode(this.toBytes());
  }

  toTruncatedBuffer() {
    const buf = this.toBuffer();
    return buf.subarray(1, buf.length);
  }

  toBuffer() {
    if (!this._bn) {
      throw new Error(`Invalid public key input`);
    }
    const buf = this._bn;
    if (buf.byteLength === SECP256R1_PUBLIC_KEY_LENGTH) {
      return buf;
    } else {
      throw new Error(`Invalid public key input`);
    }
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
