import { expect } from "chai";
import type { TestContext } from "../types.ts";

/**
 * Type guard to ensure all required context properties are present
 */
export function assertTestContext(
  ctx: TestContext,
  requiredFields: (keyof TestContext)[] = [
    "index",
    "multiWalletVault",
    "payer",
    "wallet",
    "domainConfig",
  ]
): asserts ctx is TestContext & {
  index: NonNullable<TestContext["index"]>;
  multiWalletVault: NonNullable<TestContext["multiWalletVault"]>;
  payer: NonNullable<TestContext["payer"]>;
  wallet: NonNullable<TestContext["wallet"]>;
} {
  for (const field of requiredFields) {
    if (ctx[field] === undefined || ctx[field] === null) {
      throw new Error(
        `Test context is missing required field: ${String(field)}. This indicates a setup issue.`
      );
    }
  }
}

/**
 * Asserts that a value is not null or undefined, throwing a descriptive error if it is
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message?: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(
      message || "Expected value to be defined but it was null or undefined"
    );
  }
}

/**
 * Wraps async test code with consistent error handling
 */
export async function withErrorHandling<T>(
  testName: string,
  testFn: () => Promise<T>
): Promise<T> {
  try {
    return await testFn();
  } catch (error) {
    console.error(`[${testName}] Test failed:`, error);
    throw error;
  }
}

/**
 * Waits for a specified number of milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Asserts that a transaction was successful by checking for a signature
 */
export function assertTransactionSuccess(signature: string | undefined): void {
  expect(signature).to.be.a("string", "Transaction should return a signature");
  expect(signature).to.not.be.empty;
}

/**
 * Asserts that an async operation throws.
 * Optionally validates that the message includes a substring, or any of several substrings.
 */
export async function expectFailure(
  operation: () => Promise<unknown>,
  expectedMessage?: string | readonly string[],
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (expectedMessage === undefined) {
      return;
    }
    const patterns = Array.isArray(expectedMessage)
      ? [...expectedMessage]
      : [expectedMessage];
    if (patterns.length === 0) {
      return;
    }
    const message =
      error instanceof Error ? error.message : JSON.stringify(error);
    const matched = patterns.some((p) => message.includes(p));
    expect(
      matched,
      `Expected error message to include one of: ${patterns.join(", ")}\nGot: ${message}`,
    ).to.be.true;
    return;
  }

  throw new Error("Expected operation to fail, but it succeeded");
}
