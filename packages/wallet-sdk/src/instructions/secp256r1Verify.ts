import {
  address,
  combineCodec,
  createDecoder,
  createEncoder,
  fixDecoderSize,
  fixEncoderSize,
  getBytesDecoder,
  getBytesEncoder,
  getStructDecoder,
  getStructEncoder,
  getU16Decoder,
  getU16Encoder,
  getU8Decoder,
  getU8Encoder,
  type Address,
  type Codec,
  type Decoder,
  type Encoder,
  type IInstruction,
  type IInstructionWithAccounts,
  type IInstructionWithData,
  type ReadonlyUint8Array,
} from "@solana/kit";
import {
  getSecp256r1PubkeyDecoder,
  getSecp256r1PubkeyEncoder,
  Secp256r1Pubkey,
} from "../generated";

export const COMPRESSED_PUBKEY_SERIALIZED_SIZE = 33;
export const SIGNATURE_SERIALIZED_SIZE = 64;
export const SIGNATURE_OFFSETS_SERIALIZED_SIZE = 14;
export const SIGNATURE_OFFSETS_START = 2;

export const SECP256R1_PROGRAM_ADDRESS = address(
  "Secp256r1SigVerify1111111111111111111111111"
);

export type Secp256r1VerifyInstruction<
  TProgram extends string = typeof SECP256R1_PROGRAM_ADDRESS
> = IInstruction<TProgram> &
  IInstructionWithData<Uint8Array> &
  IInstructionWithAccounts<[]>;

export type Secp256r1VerifyInstructionData = {
  numSignatures: number;
  padding: number;
  offsets: Secp256r1SignatureOffsetsDataArgs[];
  payload: {
    publicKey: Secp256r1Pubkey;
    signature: ReadonlyUint8Array;
    message: ReadonlyUint8Array;
  }[];
};

export type Secp256r1SignatureOffsetsDataArgs = {
  signatureOffset: number;
  signatureInstructionIndex: number;
  publicKeyOffset: number;
  publicKeyInstructionIndex: number;
  messageDataOffset: number;
  messageDataSize: number;
  messageInstructionIndex: number;
};

export function getSecp256r1SignatureOffsetsDataEncoder(): Encoder<Secp256r1SignatureOffsetsDataArgs> {
  return getStructEncoder([
    ["signatureOffset", getU16Encoder()],
    ["signatureInstructionIndex", getU16Encoder()],
    ["publicKeyOffset", getU16Encoder()],
    ["publicKeyInstructionIndex", getU16Encoder()],
    ["messageDataOffset", getU16Encoder()],
    ["messageDataSize", getU16Encoder()],
    ["messageInstructionIndex", getU16Encoder()],
  ]);
}

export function getSecp256r1SignatureOffsetsDataDecoder(): Decoder<Secp256r1SignatureOffsetsDataArgs> {
  return getStructDecoder([
    ["signatureOffset", getU16Decoder()],
    ["signatureInstructionIndex", getU16Decoder()],
    ["publicKeyOffset", getU16Decoder()],
    ["publicKeyInstructionIndex", getU16Decoder()],
    ["messageDataOffset", getU16Decoder()],
    ["messageDataSize", getU16Decoder()],
    ["messageInstructionIndex", getU16Decoder()],
  ]);
}

export function getSecp256r1VerifyInstructionDataDecoder(): Decoder<Secp256r1VerifyInstructionData> {
  return createDecoder({
    read: (bytes, offset = 0) => {
      const numSignatures = getU8Decoder().decode(bytes, offset);
      offset += 1;

      const padding = getU8Decoder().decode(bytes, offset);
      offset += 1;

      const offsets: Secp256r1SignatureOffsetsDataArgs[] = [];
      const offsetDecoder = getSecp256r1SignatureOffsetsDataDecoder();
      for (let i = 0; i < numSignatures; i++) {
        offsets.push(offsetDecoder.decode(bytes, offset));
        offset += SIGNATURE_OFFSETS_SERIALIZED_SIZE;
      }
      const payload: {
        publicKey: Secp256r1Pubkey;
        signature: ReadonlyUint8Array;
        message: ReadonlyUint8Array;
      }[] = [];

      for (let i = 0; i < numSignatures; i++) {
        const publicKey = getSecp256r1PubkeyDecoder().decode(bytes, offset);
        offset += COMPRESSED_PUBKEY_SERIALIZED_SIZE;

        const signature = fixDecoderSize(
          getBytesDecoder(),
          SIGNATURE_SERIALIZED_SIZE
        ).decode(bytes, offset);
        offset += SIGNATURE_SERIALIZED_SIZE;

        const messageSize = offsets[i].messageDataSize;
        const message = fixDecoderSize(getBytesDecoder(), messageSize).decode(
          bytes,
          offset
        );
        offset += messageSize;

        payload.push({ publicKey, signature, message });
      }
      return [
        {
          numSignatures,
          padding,
          offsets,
          payload,
        },
        offset,
      ];
    },
  });
}

export function getSecp256r1VerifyInstructionDataEncoder(): Encoder<Secp256r1VerifyInstructionDataArgs> {
  return createEncoder({
    getSizeFromValue: (value: Secp256r1VerifyInstructionData) => {
      const offsetSize =
        SIGNATURE_OFFSETS_SERIALIZED_SIZE * value.offsets.length;
      const payloadSize = value.payload.reduce((sum, p) => {
        return (
          sum +
          COMPRESSED_PUBKEY_SERIALIZED_SIZE +
          SIGNATURE_SERIALIZED_SIZE +
          p.message.length
        );
      }, 0);
      return 2 + offsetSize + payloadSize; // 1 byte for numSignatures, 1 for padding
    },
    write: (value: Secp256r1VerifyInstructionData, bytes, offset = 0) => {
      offset = getU8Encoder().write(value.numSignatures, bytes, offset);
      offset = getU8Encoder().write(value.padding, bytes, offset);

      const offsetEncoder = getSecp256r1SignatureOffsetsDataEncoder();
      for (const offsetEntry of value.offsets) {
        offset = offsetEncoder.write(offsetEntry, bytes, offset);
      }

      for (const entry of value.payload) {
        offset = getSecp256r1PubkeyEncoder().write(
          entry.publicKey,
          bytes,
          offset
        );

        offset = fixEncoderSize(
          getBytesEncoder(),
          SIGNATURE_SERIALIZED_SIZE
        ).write(entry.signature, bytes, offset);

        offset = getBytesEncoder().write(entry.message, bytes, offset);
      }

      return offset;
    },
  });
}

export type Secp256r1VerifyInstructionDataArgs = {
  numSignatures: number;
  padding: number;
  offsets: Secp256r1SignatureOffsetsDataArgs[];
  payload: {
    publicKey: Secp256r1Pubkey;
    signature: ReadonlyUint8Array;
    message: ReadonlyUint8Array;
  }[];
};

export function getSecp256r1VerifyInstructionDataCodec(): Codec<
  Secp256r1VerifyInstructionDataArgs,
  Secp256r1VerifyInstructionData
> {
  return combineCodec(
    getSecp256r1VerifyInstructionDataEncoder(),
    getSecp256r1VerifyInstructionDataDecoder()
  );
}

export type Secp256r1VerifyInput = {
  publicKey: Secp256r1Pubkey;
  signature: ReadonlyUint8Array;
  message: ReadonlyUint8Array;
}[];

export function getSecp256r1VerifyInstruction<
  TProgramAddress extends Address = typeof SECP256R1_PROGRAM_ADDRESS
>(
  input: Secp256r1VerifyInput,
  config?: { programAddress?: TProgramAddress }
): Secp256r1VerifyInstruction<TProgramAddress> {
  let numSignatures = input.length;
  let currentOffset =
    SIGNATURE_OFFSETS_START + numSignatures * SIGNATURE_OFFSETS_SERIALIZED_SIZE;
  const offsets = [];
  for (let i = 0; i < numSignatures; i++) {
    const { message } = input[i];
    const publicKeyOffset = currentOffset;
    const signatureOffset = publicKeyOffset + COMPRESSED_PUBKEY_SERIALIZED_SIZE;
    const messageDataOffset = signatureOffset + SIGNATURE_SERIALIZED_SIZE;
    offsets.push({
      publicKeyOffset,
      publicKeyInstructionIndex: 0xffff,
      signatureOffset,
      signatureInstructionIndex: 0xffff,
      messageDataOffset,
      messageDataSize: message.length,
      messageInstructionIndex: 0xffff,
    } as Secp256r1SignatureOffsetsDataArgs);
    currentOffset +=
      COMPRESSED_PUBKEY_SERIALIZED_SIZE +
      SIGNATURE_SERIALIZED_SIZE +
      message.length;
  }

  // Program address.
  const programAddress = config?.programAddress ?? SECP256R1_PROGRAM_ADDRESS;

  // Original args.
  const args = {
    numSignatures,
    padding: 0,
    offsets,
    payload: input,
  };

  // Resolve default values.
  const instruction = {
    accounts: [],
    programAddress,
    data: getSecp256r1VerifyInstructionDataEncoder().encode(
      args as Secp256r1VerifyInstructionDataArgs
    ),
  } as Secp256r1VerifyInstruction<TProgramAddress>;

  return instruction;
}

export type ParsedSecp256r1VerifyInstruction<
  TProgram extends string = typeof SECP256R1_PROGRAM_ADDRESS
> = {
  programAddress: Address<TProgram>;
  accounts: {};
  data: Secp256r1VerifyInstructionData;
};

export function parseSecp256r1VerifyInstruction<TProgram extends string>(
  instruction: IInstruction<TProgram> & IInstructionWithData<Uint8Array>
): ParsedSecp256r1VerifyInstruction<TProgram> {
  return {
    programAddress: instruction.programAddress,
    accounts: {},
    data: getSecp256r1VerifyInstructionDataDecoder().decode(instruction.data),
  };
}
