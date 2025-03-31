import { AuthenticationResponse } from "./types.js";

export async function openAuthUrl(
  authUrl: string
): Promise<AuthenticationResponse> {
  return new Promise((resolve, reject) => {
    const screenWidth = window.innerWidth || screen.width;
    const screenHeight = window.innerHeight || screen.height;

    const width = Math.min(
      500,
      screenWidth < 768 ? screenWidth : Math.floor(screenWidth * 0.5)
    );
    const height = Math.min(
      600,
      screenHeight < 768 ? screenHeight : Math.floor(screenHeight * 0.7)
    );
    const left = Math.floor((screenWidth - width) / 2);
    const top = Math.floor((screenHeight - height) / 2);
    const allowedOrigin = new URL(authUrl).origin;

    const popup = window.open(
      authUrl,
      "passkeyPopup",
      `width=${width},height=${height},top=${top},left=${left},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes`
    );

    if (!popup) {
      reject(new Error("Disable your popup blocker to continue."));
      return;
    }

    const interval = setInterval(() => {
      if (popup.closed) {
        clearInterval(interval);
        window.removeEventListener("message", messageHandler);
        reject(new Error("User closed the authentication window"));
      }
    }, 500);

    const messageHandler = (event: MessageEvent) => {
      if (
        !event.isTrusted ||
        event.origin !== allowedOrigin ||
        !event.data ||
        event.data.type !== "passkey-auth"
      ) {
        return;
      }

      try {
        const payload = JSON.parse(event.data.payload);
        clearInterval(interval);
        window.removeEventListener("message", messageHandler);
        popup.close();
        resolve(payload);
      } catch (error) {
        reject(new Error("Failed to parse authentication response payload"));
      }
    };
    // ensure that only one listener is added
    window.removeEventListener("message", messageHandler);
    window.addEventListener("message", messageHandler);
  });
}
