/**
 * PKCE utilities (RFC 7636) using the Web Crypto API. Works in Bun (and
 * browsers). Ported from earendil-works/pi `oauth/pkce.ts`.
 */

/** Encode bytes as base64url (RFC 4648 §5). */
const base64urlEncode = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
};

/** Generate a PKCE code verifier (43 chars) + its S256 challenge. */
export const generatePKCE = async (): Promise<{ verifier: string; challenge: string }> => {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64urlEncode(verifierBytes);

  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  const challenge = base64urlEncode(new Uint8Array(hashBuffer));

  return { verifier, challenge };
};