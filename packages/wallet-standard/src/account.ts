import { address, getAddressEncoder } from "@solana/kit";
import type { IdentifierString } from "@wallet-standard/base";
import { ReadonlyWalletAccount } from "@wallet-standard/wallet";

/**
 * A Wallet Standard account backed by a Revibase multisig vault.
 *
 * `address` is the on-chain vault (`UserInfo.walletAddress`) — the account a
 * dApp transacts with. `publicKey` is the decoded bytes of that address; note
 * it is a PDA, not an ed25519 keypair, so callers cannot ed25519-verify
 * signatures against it.
 */
export class RevibaseWalletAccount extends ReadonlyWalletAccount {
  constructor(walletAddress: string, chains: readonly IdentifierString[]) {
    super({
      address: walletAddress,
      publicKey: new Uint8Array(
        getAddressEncoder().encode(address(walletAddress)),
      ),
      chains,
      // Only sign-and-send is supported today (see README "Constraints").
      features: ["solana:signAndSendTransaction"],
    });
  }
}
