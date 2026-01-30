/**
 * Async utility functions for better error handling and composition
 */

import { NetworkError } from "../errors";

/**
 * Validates a fetch response and throws appropriate errors
 * @param response - Fetch response
 * @param url - Optional URL for error context
 * @returns Response if valid
 * @throws {NetworkError} If response is not ok
 */
export async function validateResponse(
  response: Response,
  url?: string,
): Promise<Response> {
  if (!response.ok) {
    throw new NetworkError(
      `Request failed: ${response.statusText} (${response.status})`,
      response.status,
      url,
    );
  }
  return response;
}

/**
 * Safely parses JSON from a response
 * @param response - Fetch response
 * @returns Parsed JSON object
 * @throws {NetworkError} If JSON parsing fails
 */
export async function parseJson<T = unknown>(response: Response): Promise<T> {
  try {
    return await response.json();
  } catch (error) {
    throw new NetworkError(
      `Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)}`,
      response.status,
      response.url,
    );
  }
}
