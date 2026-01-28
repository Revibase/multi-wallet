import {
  type AccountProofInput,
  getLightSystemAccountMetasV2,
  type NewAddressProofInput,
  type PackedAddressTreeInfo,
  type PackedStateTreeInfo,
  type PackedTreeInfos,
  selectStateTreeInfo,
  type TreeInfo,
  TreeType,
} from "@lightprotocol/stateless.js";
import { PublicKey } from "@solana/web3.js";
import {
  type AccountMeta,
  AccountRole,
  type AccountSignerMeta,
  address,
} from "gill";
import { MULTI_WALLET_PROGRAM_ADDRESS } from "../../generated";
import { getLightProtocolRpc } from "../initialize";

/** Internal data structure for account mapping */
interface MapData {
  index: number;
  accountMeta: AccountMeta;
}

/**
 * Manages packing of accounts for compressed account operations
 * Handles account deduplication, indexing, and tree information packing
 */
export class PackedAccounts {
  /** Accounts added before system accounts */
  preAccounts: AccountMeta[];
  /** Light Protocol system accounts */
  systemAccounts: AccountMeta[];
  /** Next available index for account mapping */
  nextIndex: number;
  /** Map of account addresses to their indices and metadata */
  map: Map<string, MapData>;
  /** Index of the output state tree */
  outputTreeIndex: number;

  constructor() {
    this.preAccounts = [];
    this.systemAccounts = [];
    this.nextIndex = 0;
    this.map = new Map();
    this.outputTreeIndex = -1;
  }

  /**
   * Adds accounts that should appear before system accounts
   * @param accounts - Accounts to add
   */
  addPreAccounts(accounts: (AccountMeta | AccountSignerMeta)[]): void {
    this.preAccounts.push(...accounts);
  }

  /**
   * Converts boolean flags to AccountRole enum
   * @param isSigner - Whether account is a signer
   * @param isWritable - Whether account is writable
   * @returns AccountRole value
   */
  getAccountRole(isSigner: boolean, isWritable: boolean): AccountRole {
    if (isSigner) {
      return isWritable
        ? AccountRole.WRITABLE_SIGNER
        : AccountRole.READONLY_SIGNER;
    } else {
      return isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;
    }
  }

  /**
   * Adds Light Protocol system accounts required for compressed account operations
   */
  async addSystemAccounts(): Promise<void> {
    this.systemAccounts.push(
      ...getLightSystemAccountMetasV2({
        selfProgram: new PublicKey(MULTI_WALLET_PROGRAM_ADDRESS.toString()),
      }).map((x) => ({
        address: address(x.pubkey.toString()),
        role: this.getAccountRole(x.isSigner, x.isWritable),
      }))
    );
  }

  /**
   * Inserts an account or returns its existing index (defaults to writable role)
   * @param pubkey - Account public key
   * @returns Account index
   */
  insertOrGet(pubkey: string): number {
    return this.insertOrGetConfig(pubkey, AccountRole.WRITABLE);
  }

  /**
   * Inserts an account with specified role or returns its existing index
   * @param pubkey - Account public key
   * @param role - Account role
   * @returns Account index
   */
  insertOrGetConfig(pubkey: string, role: AccountRole): number {
    if (!this.map.has(pubkey)) {
      const index = this.nextIndex++;
      const accountMeta: AccountMeta = {
        address: address(pubkey),
        role,
      };
      this.map.set(pubkey, { index, accountMeta });
    }
    return this.map.get(pubkey)!.index;
  }

  /**
   * Packs output tree index based on tree type
   * @param outputStateTreeInfo - State tree information
   * @returns Index of the output tree
   * @throws {Error} If tree type is not supported
   */
  packOutputTreeIndex(outputStateTreeInfo: TreeInfo) {
    if (outputStateTreeInfo.treeType === TreeType.StateV1) {
      return this.insertOrGet(outputStateTreeInfo.tree.toString());
    } else if (outputStateTreeInfo.treeType === TreeType.StateV2) {
      return this.insertOrGet(outputStateTreeInfo.queue.toString());
    }
    throw new Error("Tree type not supported");
  }

  /**
   * Gets the output tree index, fetching from RPC if not already set
   * @returns Output tree index
   */
  async getOutputTreeIndex() {
    if (this.outputTreeIndex !== -1) {
      return this.outputTreeIndex;
    }
    const stateTreeInfos = await getLightProtocolRpc().getStateTreeInfos();
    const selectedStateTree = selectStateTreeInfo(stateTreeInfos);
    const outputStateTreeIndex = this.packOutputTreeIndex(selectedStateTree);
    return outputStateTreeIndex;
  }

  /**
   * Packs tree information for account proofs and new address proofs
   * Creates packed tree info structures with account indices
   * @param accountProofInputs - Proof inputs for existing accounts
   * @param newAddressProofInputs - Proof inputs for new addresses
   * @returns Packed tree information with state and address trees
   */
  packTreeInfos(
    accountProofInputs: AccountProofInput[],
    newAddressProofInputs: NewAddressProofInput[]
  ): PackedTreeInfos {
    const stateTreeInfos: PackedStateTreeInfo[] = [];
    const addressTreeInfos: PackedAddressTreeInfo[] = [];

    for (const account of accountProofInputs) {
      const merkleTreePubkeyIndex = this.insertOrGet(
        account.treeInfo.tree.toString()
      );
      const queuePubkeyIndex = this.insertOrGet(
        account.treeInfo.queue.toString()
      );

      stateTreeInfos.push({
        rootIndex: account.rootIndex,
        merkleTreePubkeyIndex,
        queuePubkeyIndex,
        leafIndex: account.leafIndex,
        proveByIndex: account.proveByIndex,
      });

      const treeToUse = account.treeInfo.nextTreeInfo ?? account.treeInfo;
      const index = this.packOutputTreeIndex(treeToUse);
      if (this.outputTreeIndex === -1) {
        this.outputTreeIndex = index;
      }
    }

    for (const account of newAddressProofInputs) {
      const addressMerkleTreePubkeyIndex = this.insertOrGet(
        account.treeInfo.tree.toString()
      );
      const addressQueuePubkeyIndex = this.insertOrGet(
        account.treeInfo.queue.toString()
      );

      addressTreeInfos.push({
        rootIndex: account.rootIndex,
        addressMerkleTreePubkeyIndex,
        addressQueuePubkeyIndex,
      });
    }

    return {
      stateTrees:
        stateTreeInfos.length > 0
          ? {
              packedTreeInfos: stateTreeInfos,
              outputTreeIndex: this.outputTreeIndex,
            }
          : undefined,
      addressTrees: addressTreeInfos,
    };
  }

  /**
   * Converts the account map to an array of account metas, sorted by index
   * @returns Array of account metas in index order
   */
  hashSetAccountsToMetas(): AccountMeta[] {
    const packedAccounts: AccountMeta[] = Array.from(this.map.entries())
      .sort((a, b) => a[1].index - b[1].index)
      .map(([, { accountMeta }]) => ({ ...accountMeta }));
    return packedAccounts;
  }

  /**
   * Calculates offset indices for system and packed accounts
   * @returns Tuple of [systemAccountsStartOffset, packedAccountsStartOffset]
   */
  getOffsets(): [number, number] {
    const systemAccountsStartOffset = this.preAccounts.length;
    const packedAccountsStartOffset =
      systemAccountsStartOffset + this.systemAccounts.length;
    return [systemAccountsStartOffset, packedAccountsStartOffset];
  }

  /**
   * Converts all accounts to a final account metas array with offsets
   * @returns Account metas array and offset indices
   */
  toAccountMetas(): {
    remainingAccounts: AccountMeta[];
    systemOffset: number;
    packedOffset: number;
  } {
    const packedAccounts = this.hashSetAccountsToMetas();
    const [systemOffset, packedOffset] = this.getOffsets();
    const remainingAccounts = [
      ...this.preAccounts,
      ...this.systemAccounts,
      ...packedAccounts,
    ];
    return { remainingAccounts, systemOffset, packedOffset };
  }
}
