import { setupTestEnvironment } from "./helpers/index.ts";
import { runDecompressionTests } from "./tests/decompression.test.ts";
import { runMemberManagementTests } from "./tests/member-management.test.ts";
import { runNativeTransferTest } from "./tests/native-transfer.test.ts";
import { runSecp256r1Tests } from "./tests/secp256r1.test.ts";
import { runTokenTransferTest } from "./tests/token-transfer.test.ts";
import { runTransactionManagerTests } from "./tests/transaction-manager.test.ts";
import { runTransactionTests } from "./tests/transactions.test.ts";
import { runWalletCreationTests } from "./tests/wallet-creation.test.ts";
import type { TestContext } from "./types.ts";

describe("Multi Wallet Tests", function () {
  let ctx: TestContext;

  before(async function () {
    ctx = await setupTestEnvironment();
  });

  describe("Wallet Creation", () => {
    runWalletCreationTests(() => ctx);
  });

  describe("Member Management", () => {
    runMemberManagementTests(() => ctx);
  });

  describe("Secp256r1 Key Management", () => {
    runSecp256r1Tests(() => ctx);
  });

  describe("Transaction Handling", () => {
    runTransactionTests(() => ctx);
  });

  describe("Transaction Manager", () => {
    runTransactionManagerTests(() => ctx);
  });

  describe("Decompression Test", () => {
    runDecompressionTests(() => ctx);
  });

  describe("Native Transfer Intent Test", () => {
    runNativeTransferTest(() => ctx);
  });

  describe("Token Transfer Intent Test", () => {
    runTokenTransferTest(() => ctx);
  });
});
