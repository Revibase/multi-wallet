import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { getBase58Decoder, getBase58Encoder, type Address } from "gill";

const SECP256R1_PUBLIC_KEY_LENGTH = 33;
type Secp256r1KeyInitData = string | Uint8Array | Array<number>;
type SignedMessageDetails = {
  verifyArgs: {
    clientDataJson: Uint8Array;
    truncatedClientDataJson: Uint8Array;
    slotNumber: bigint;
    slotHash: Uint8Array;
  };
  domainConfig: Address;
  authData: Uint8Array;
  signature: Uint8Array;
  originIndex: number;
  crossOrigin: boolean;
  clientAndDeviceHash: Uint8Array;
  authResponse: AuthenticationResponseJSON;
};

export class Secp256r1Key {
  protected _bn: Uint8Array | undefined;

  constructor(value: Secp256r1KeyInitData) {
    if (typeof value === "string") {
      this._bn = new Uint8Array(getBase58Encoder().encode(value));
    } else {
      this._bn = new Uint8Array(value);
    }
    this.validateKeyLength(this._bn);
  }

  protected validateKeyLength(key: Uint8Array | Array<number>) {
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

export class SignedSecp256r1Key extends Secp256r1Key {
  verifyArgs: SignedMessageDetails["verifyArgs"];
  domainConfig: SignedMessageDetails["domainConfig"];
  authData: SignedMessageDetails["authData"];
  signature: SignedMessageDetails["signature"];
  originIndex: SignedMessageDetails["originIndex"];
  crossOrigin: SignedMessageDetails["crossOrigin"];
  clientAndDeviceHash: SignedMessageDetails["clientAndDeviceHash"];
  authResponse: SignedMessageDetails["authResponse"];

  constructor(value: Secp256r1KeyInitData, signed: SignedMessageDetails) {
    super(value);
    this.verifyArgs = signed.verifyArgs;
    this.domainConfig = signed.domainConfig;
    this.authData = signed.authData;
    this.signature = signed.signature;
    this.originIndex = signed.originIndex;
    this.crossOrigin = signed.crossOrigin;
    this.clientAndDeviceHash = signed.clientAndDeviceHash;
    this.authResponse = signed.authResponse;
  }
}
