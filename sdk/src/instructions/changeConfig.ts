import { Connection, PublicKey, type AccountMeta } from "@solana/web3.js";

import { fetchSettingsData } from "../functions/fetchSettingsData";
import { ConfigAction, Permission, Permissions, Secp256r1Key } from "../types";
import {
  convertMemberkeyToPubKey,
  convertPubkeyToMemberkey,
  getDelegateAddress,
  getMultiWalletFromSettings,
  isEquals,
  program,
} from "../utils";

export async function changeConfig({
  connection,
  settings,
  feePayer,
  configActions,
}: {
  connection: Connection;
  settings: PublicKey;
  feePayer: PublicKey;
  configActions: ConfigAction[];
}) {
  const multiWallet = getMultiWalletFromSettings(settings);
  const config: any[] = [];
  let remainingAccounts: AccountMeta[] = [];
  for (const action of configActions) {
    switch (action.type) {
      case "addMembers":
        config.push({
          addMembers: [
            action.members.map((x) => ({
              ...x,
              pubkey: convertPubkeyToMemberkey(x.pubkey),
            })),
          ],
        });
        remainingAccounts = action.members.map((x) => ({
          pubkey: getDelegateAddress(x.pubkey),
          isWritable: true,
          isSigner: false,
        }));
        break;
      case "removeMembers":
        config.push({
          removeMembers: [action.members.map(convertPubkeyToMemberkey)],
        });
        remainingAccounts = action.members.map((x) => ({
          pubkey: getDelegateAddress(x),
          isWritable: true,
          isSigner: false,
        }));
        break;
      case "setMembers":
        config.push({
          setMembers: [
            action.members.map((x) => ({
              ...x,
              pubkey: convertPubkeyToMemberkey(x.pubkey),
            })),
          ],
        });
        const settingsData = await fetchSettingsData(connection, settings);
        if (!settingsData) {
          throw new Error("Unable to fetch settings data.");
        }

        const hashSet = new Set<PublicKey | Secp256r1Key>();
        settingsData.members
          .filter((x) => Permissions.has(x.permissions, Permission.IsDelegate))
          .filter(
            (x) => !action.members.some((y) => isEquals(y.pubkey, x.pubkey))
          )
          .forEach((x) => hashSet.add(convertMemberkeyToPubKey(x.pubkey)));
        action.members
          .filter((x) => Permissions.has(x.permissions, Permission.IsDelegate))
          .filter(
            (x) =>
              !settingsData.members.some((y) => isEquals(x.pubkey, y.pubkey))
          )
          .forEach((x) => hashSet.add(x.pubkey));
        remainingAccounts = Array.from(hashSet).map((x) => ({
          pubkey: getDelegateAddress(x),
          isWritable: true,
          isSigner: false,
        }));
        break;
      case "setThreshold":
        config.push({ setThreshold: [action.threshold] });
        break;
      case "setMetadata":
        config.push({ setMetadata: [action.metadata] });
        break;
    }
  }

  return await program.methods
    .changeConfig(config)
    .accountsPartial({
      multiWallet,
      settings,
      payer: feePayer,
      program: program.programId,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();
}
