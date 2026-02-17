import {
  getBase58Decoder,
  getBase64Encoder,
  getTransactionDecoder,
  type KeyPairSigner,
} from "gill";

export async function createTransactionSigner(
  request: {
    transactions: string[];
  },
  privateKey: KeyPairSigner,
) {
  const signatures = new Array<string>(request.transactions.length);

  for (let i = 0; i < request.transactions.length; i++) {
    const { messageBytes } = getTransactionDecoder().decode(
      getBase64Encoder().encode(request.transactions[i]),
    );
    const signature = await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey.keyPair.privateKey,
      new Uint8Array(messageBytes),
    );
    signatures[i] = getBase58Decoder().decode(new Uint8Array(signature));
  }
  return { signatures };
}
