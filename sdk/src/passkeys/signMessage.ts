import { IDP_URL } from "./consts.js";
import { openAuthUrl } from "./utils.js";

export async function signMessage(message: string, publicKey?: string) {
  if (!window) {
    throw new Error("Function can only be called in a browser environment");
  }

  const authUrl = `${IDP_URL}/?message=${encodeURIComponent(
    message
  )}&redirectUrl=${encodeURIComponent(window.origin)}${
    publicKey ? `&publicKey=${encodeURIComponent(publicKey)}` : ""
  }`;
  return await openAuthUrl(authUrl);
}
