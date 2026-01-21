import { setupTestEnvironment } from "./helpers/index.ts";
import { runTokenTransferTest } from "./tests/token-transfer.test.ts";
import type { TestContext } from "./types.ts";

describe("Multi Wallet Tests", function () {
  let ctx: TestContext;

  before(async function () {
    ctx = await setupTestEnvironment();
  });

  // describe("Wallet Creation", () => {
  //   runWalletCreationTests(() => ctx);
  // });

  // describe("Member Management", () => {
  //   runMemberManagementTests(() => ctx);
  // });

  // describe("Threshold Management", () => {
  //   runThresholdManagementTests(() => ctx);
  // });

  // describe("Permissions Management", () => {
  //   runPermissionsTests(() => ctx);
  // });

  // describe("Secp256r1 Key Management", () => {
  //   runSecp256r1Tests(() => ctx);
  // });

  // describe("Transaction Handling", () => {
  //   runTransactionTests(() => ctx);
  // });

  // describe("Transaction Manager", () => {
  //   runTransactionManagerTests(() => ctx);
  // });

  // describe("Decompression Test", () => {
  //   runDecompressionTests(() => ctx);
  // });

  // describe("Native Transfer Intent Test", () => {
  //   runNativeTransferTest(() => ctx);
  // });

  describe("Token Transfer Intent Test", () => {
    runTokenTransferTest(() => ctx);
  });

  // describe("Error Cases and Validation", () => {
  //   runErrorCasesTests(() => ctx);
  // });
});
