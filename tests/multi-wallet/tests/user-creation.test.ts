import {
  bufferToBase64URLString,
  createDomainUserAccounts,
  createUserAccounts,
  fetchUser,
  getSettingsFromIndex,
  getSolanaRpc,
  getUserAddress,
  Secp256r1Key,
  Transports,
  UserRole,
} from "@revibase/core";
import { expect } from "chai";
import { createKeyPairSignerFromPrivateKeyBytes } from "gill";
import {
  TEST_AMOUNT_MEDIUM,
  TEST_TRANSACTION_MANAGER_URL,
} from "../constants.ts";
import {
  assertTestContext,
  createMultiWallet,
  fundMultiWalletVault,
  generateSecp256r1KeyPair,
  sendTransaction,
  withErrorHandling,
} from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runUserCreationTests(getCtx: () => TestContext) {
  it("should create user account", async () => {
    await withErrorHandling("create multi-wallet", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, [
        "index",
        "multiWalletVault",
        "wallet",
        "payer",
        "domainConfig",
      ]);

      await fundMultiWalletVault(ctx, BigInt(TEST_AMOUNT_MEDIUM));

      // Create transaction manager
      const user = await createKeyPairSignerFromPrivateKeyBytes(
        crypto.getRandomValues(new Uint8Array(32)),
      );
      const createUserAccountIx = await createUserAccounts({
        payer: ctx.payer,
        createUserArgs: {
          member: user,
          role: UserRole.Member,
        },
      });

      await sendTransaction([createUserAccountIx], ctx.payer);

      const userAccountData = (
        await fetchUser(getSolanaRpc(), await getUserAddress(user.address))
      ).data;
      expect(
        userAccountData.role,
        "Created user should have member role",
      ).to.equal(UserRole.Member);
    });
  });

  it("should create transaction manager user account", async () => {
    await withErrorHandling("create multi-wallet", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, [
        "index",
        "multiWalletVault",
        "wallet",
        "payer",
        "domainConfig",
      ]);

      await fundMultiWalletVault(ctx, BigInt(TEST_AMOUNT_MEDIUM));

      // Create transaction manager
      const transactionManager = await createKeyPairSignerFromPrivateKeyBytes(
        crypto.getRandomValues(new Uint8Array(32)),
      );
      const createUserAccountIx = await createUserAccounts({
        payer: ctx.payer,
        createUserArgs: {
          member: transactionManager,
          role: UserRole.TransactionManager,
          transactionManagerUrl: TEST_TRANSACTION_MANAGER_URL,
        },
      });

      await sendTransaction([createUserAccountIx], ctx.payer);

      const userAccountData = (
        await fetchUser(
          getSolanaRpc(),
          await getUserAddress(transactionManager.address),
        )
      ).data;
      expect(
        userAccountData.role,
        "Created user should have transaction manager role",
      ).to.equal(UserRole.TransactionManager);
      if (userAccountData.transactionManagerUrl.__option === "Some") {
        expect(
          userAccountData.transactionManagerUrl.value,
          "Transaction manager URL should match configured value",
        ).to.equal(TEST_TRANSACTION_MANAGER_URL);
      } else {
        throw new Error("Transaction manager URL should be present");
      }
    });
  });

  it("should create domain user account", async () => {
    await withErrorHandling("create multi-wallet", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, [
        "index",
        "multiWalletVault",
        "wallet",
        "payer",
        "domainConfig",
      ]);

      await fundMultiWalletVault(ctx, BigInt(TEST_AMOUNT_MEDIUM));
      const secp256r1Keys = generateSecp256r1KeyPair();
      const credentialId = bufferToBase64URLString(
        crypto.getRandomValues(new Uint8Array(64)),
      );
      // Create Secp256r1Key and add member to an existing wallet owned by the authority together with a transaction manager
      const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
      const createDomainUserAccountIx = await createDomainUserAccounts({
        payer: ctx.payer,
        authority: ctx.wallet,
        domainConfig: ctx.domainConfig!,
        createUserArgs: {
          member: secp256r1Key,
          role: UserRole.Member,
          settings: await getSettingsFromIndex(ctx.index),
          credentialId,
          transports: [Transports.Internal, Transports.Hybrid],
        },
      });

      await sendTransaction([createDomainUserAccountIx], ctx.payer);

      const userAccountData = (
        await fetchUser(getSolanaRpc(), await getUserAddress(secp256r1Key))
      ).data;
      expect(
        userAccountData.role,
        "Created domain user should have member role",
      ).to.equal(UserRole.Member);
      const delegatedWallet = userAccountData.wallets.find((x) => x.isDelegate);
      expect(
        delegatedWallet?.index,
        "Domain user should be delegated to the created wallet index",
      ).to.equal(ctx.index);
    });
  });

  it("should create domain user account with transaction manager", async () => {
    await withErrorHandling("create multi-wallet", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, [
        "index",
        "multiWalletVault",
        "wallet",
        "payer",
        "domainConfig",
      ]);

      await fundMultiWalletVault(ctx, BigInt(TEST_AMOUNT_MEDIUM));

      // Create transaction manager
      const transactionManager = await createKeyPairSignerFromPrivateKeyBytes(
        crypto.getRandomValues(new Uint8Array(32)),
      );
      const createUserAccountIx = await createUserAccounts({
        payer: ctx.payer,
        createUserArgs: {
          member: transactionManager,
          role: UserRole.TransactionManager,
          transactionManagerUrl: TEST_TRANSACTION_MANAGER_URL,
        },
      });

      await sendTransaction([createUserAccountIx], ctx.payer);

      const secp256r1Keys = generateSecp256r1KeyPair();
      const credentialId = bufferToBase64URLString(
        crypto.getRandomValues(new Uint8Array(64)),
      );
      // Create Secp256r1Key and add member to an existing wallet owned by the authority together with a transaction manager
      const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
      const createDomainUserAccountIx = await createDomainUserAccounts({
        payer: ctx.payer,
        authority: ctx.wallet,
        domainConfig: ctx.domainConfig!,
        createUserArgs: {
          member: secp256r1Key,
          role: UserRole.PermanentMember,
          settings: await getSettingsFromIndex(ctx.index),
          credentialId,
          transactionManagerAccount: await getUserAddress(
            transactionManager.address,
          ),
          transports: [Transports.Internal, Transports.Hybrid],
        },
      });

      await sendTransaction([createDomainUserAccountIx], ctx.payer);

      const userAccountData = (
        await fetchUser(getSolanaRpc(), await getUserAddress(secp256r1Key))
      ).data;
      expect(
        userAccountData.role,
        "Created domain user should have permanent member role",
      ).to.equal(UserRole.PermanentMember);
      const delegatedWallet = userAccountData.wallets.find((x) => x.isDelegate);
      expect(
        delegatedWallet?.index,
        "Domain user should be delegated to the created wallet index",
      ).to.equal(ctx.index);
    });
  });
}
