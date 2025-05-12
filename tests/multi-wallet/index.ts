import { describe } from "mocha";
import { runMemberManagementTests } from "./tests/member-management.test";
import { runSecp256r1Tests } from "./tests/secp256r1.test";
import { runTransactionTests } from "./tests/transactions.test";
import { runWalletCreationTests } from "./tests/wallet-creation.test";

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
});
