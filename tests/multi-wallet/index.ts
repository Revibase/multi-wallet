import { runTransactionManagerTests } from "./tests/transaction-manager.test.ts";

describe("Multi Wallet Tests", function () {
  // describe("Wallet Creation", () => {
  //   runWalletCreationTests();
  // });

  // describe("Member Management", () => {
  //   runMemberManagementTests();
  // });

  // describe("Secp256r1 Key Management", () => {
  //   runSecp256r1Tests();
  // });

  // describe("Transaction Handling", () => {
  //   runTransactionTests();
  // });

  describe("Transaction Manager", () => {
    runTransactionManagerTests();
  });

  // describe("Decompression Test", () => {
  //   runDecompressionTests();
  // });

  // describe("Compression Test", () => {
  //   runCompressionTests();
  // });
});
