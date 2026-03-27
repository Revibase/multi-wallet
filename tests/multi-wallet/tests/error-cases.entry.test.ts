/**
 * Standalone entry to run only error-case tests (see `error-cases.test.ts`).
 * Usage: `pnpm test -- tests/multi-wallet/tests/error-cases.entry.test.ts`
 */
import { setupTestEnvironment } from "../helpers/index.ts";
import type { TestContext } from "../types.ts";
import { runErrorCasesTests } from "./error-cases.test.ts";

describe("Error Cases and Validation", function () {
  let ctx: TestContext;

  before(async function () {
    ctx = await setupTestEnvironment();
  });

  runErrorCasesTests(() => ctx);
});
