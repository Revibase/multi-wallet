import {
  type AccountProofInput,
  defaultStaticAccountsStruct,
  lightSystemProgram,
  type NewAddressProofInput,
  type PackedAddressTreeInfo,
  type PackedStateTreeInfo,
  type PackedTreeInfos,
  selectStateTreeInfo,
  type TreeInfo,
  TreeType,
} from "@lightprotocol/stateless.js";
import {
  type AccountMeta,
  AccountRole,
  type AccountSignerMeta,
  address,
} from "gill";
import { SYSTEM_PROGRAM_ADDRESS } from "gill/programs";
import { MULTI_WALLET_PROGRAM_ADDRESS } from "../../generated";
import { getLightProtocolRpc } from "../initialize";
import { getLightCpiSigner } from "./internal";

interface MapData {
  index: number;
  accountMeta: AccountMeta;
}

export class PackedAccounts {
  preAccounts: AccountMeta[];
  systemAccounts: AccountMeta[];
  nextIndex: number;
  map: Map<string, MapData>;
  outputTreeIndex: number;

  constructor() {
    this.preAccounts = [];
    this.systemAccounts = [];
    this.nextIndex = 0;
    this.map = new Map();
    this.outputTreeIndex = -1;
  }

  addPreAccounts(accounts: (AccountMeta | AccountSignerMeta)[]): void {
    this.preAccounts.push(...accounts);
  }

  async addSystemAccounts(): Promise<void> {
    const staticAccounts = defaultStaticAccountsStruct();
    this.systemAccounts.push(
      ...[
        lightSystemProgram,
        await getLightCpiSigner(),
        staticAccounts.registeredProgramPda,
        staticAccounts.noopProgram,
        staticAccounts.accountCompressionAuthority,
        staticAccounts.accountCompressionProgram,
        MULTI_WALLET_PROGRAM_ADDRESS,
        SYSTEM_PROGRAM_ADDRESS,
      ].map((x) => ({
        address: address(x.toString()),
        role: AccountRole.READONLY,
      }))
    );
  }

  insertOrGet(pubkey: string): number {
    return this.insertOrGetConfig(pubkey, AccountRole.WRITABLE);
  }

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

  packOutputTreeIndex(outputStateTreeInfo: TreeInfo) {
    if (outputStateTreeInfo.treeType === TreeType.StateV1) {
      return this.insertOrGet(outputStateTreeInfo.tree.toString());
    } else if (outputStateTreeInfo.treeType === TreeType.StateV2) {
      return this.insertOrGet(outputStateTreeInfo.queue.toString());
    }
    throw new Error("Tree type not supported");
  }

  async getOutputTreeIndex() {
    if (this.outputTreeIndex !== -1) {
      return this.outputTreeIndex;
    }
    const stateTreeInfos = await getLightProtocolRpc().getStateTreeInfos();
    const outputStateTreeIndex = this.packOutputTreeIndex(
      selectStateTreeInfo(stateTreeInfos)
    );
    return outputStateTreeIndex;
  }

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

  hashSetAccountsToMetas(): AccountMeta[] {
    const packedAccounts: AccountMeta[] = Array.from(this.map.entries())
      .sort((a, b) => a[1].index - b[1].index)
      .map(([, { accountMeta }]) => ({ ...accountMeta }));
    return packedAccounts;
  }

  getOffsets(): [number, number] {
    const systemAccountsStartOffset = this.preAccounts.length;
    const packedAccountsStartOffset =
      systemAccountsStartOffset + this.systemAccounts.length;
    return [systemAccountsStartOffset, packedAccountsStartOffset];
  }

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
