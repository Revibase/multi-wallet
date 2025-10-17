import { runCompressionTests } from "./tests/compression.test.ts";
import { runDecompressionTests } from "./tests/decompression.test.ts";
import { runMemberManagementTests } from "./tests/member-management.test.ts";
import { runNativeTransferTest } from "./tests/native-transfer.test.ts";
import { runSecp256r1Tests } from "./tests/secp256r1.test.ts";
import { runTokenTransferTest } from "./tests/token-transfer.test.ts";
import { runTransactionManagerTests } from "./tests/transaction-manager.test.ts";
import { runTransactionTests } from "./tests/transactions.test.ts";
import { runWalletCreationTests } from "./tests/wallet-creation.test.ts";

describe("Multi Wallet Tests", function () {
  describe("Wallet Creation", () => {
    runWalletCreationTests();
  });

  describe("Member Management", () => {
    runMemberManagementTests();
  });

  describe("Secp256r1 Key Management", () => {
    runSecp256r1Tests();
  });

  describe("Transaction Handling", () => {
    runTransactionTests();
  });

  describe("Transaction Manager", () => {
    runTransactionManagerTests();
  });

  describe("Decompression Test", () => {
    runDecompressionTests();
  });

  describe("Compression Test", () => {
    runCompressionTests();
  });

  describe("Native Transfer Intent Test", () => {
    runNativeTransferTest();
  });

  describe("Token Transfer Intent Test", () => {
    runTokenTransferTest();
  });
});
