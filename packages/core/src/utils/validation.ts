/**
 * Validation utilities for common input checks
 * Provides consistent validation across the SDK
 */

import { ValidationError } from "../errors";

/**
 * Validates that a number is within a range
 * @param value - Number to validate
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (inclusive)
 * @param name - Name of the parameter for error messages
 * @throws {ValidationError} If value is out of range
 */
export function requireInRange(
  value: number,
  min: number,
  max: number,
  name: string
): void {
  if (value < min || value > max) {
    throw new ValidationError(
      `${name} must be between ${min} and ${max} (inclusive), got ${value}`
    );
  }
}

/**
 * Validates that a number is non-negative
 * @param value - Number to validate
 * @param name - Name of the parameter for error messages
 * @throws {ValidationError} If value is negative
 */
export function requireNonNegative(value: number, name: string): void {
  if (value < 0) {
    throw new ValidationError(`${name} must be non-negative, got ${value}`);
  }
}

/**
 * Validates that an array is not empty
 * @param array - Array to validate
 * @param name - Name of the parameter for error messages
 * @throws {ValidationError} If array is empty
 */
export function requireNonEmpty<T>(
  array: readonly T[],
  name: string
): asserts array is readonly [T, ...T[]] {
  if (array.length === 0) {
    throw new ValidationError(`${name} cannot be empty`);
  }
}

/**
 * Validates that a string is not empty
 * @param value - String to validate
 * @param name - Name of the parameter for error messages
 * @throws {ValidationError} If string is empty
 */
export function requireNonEmptyString(
  value: string,
  name: string
): asserts value is string {
  if (value.trim().length === 0) {
    throw new ValidationError(`${name} cannot be empty`);
  }
}
