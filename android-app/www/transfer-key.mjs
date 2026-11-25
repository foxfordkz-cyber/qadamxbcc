const base = "/protection/transfer-key";

export function canUseTransferKey(browser = globalThis) {
  const type = browser.PublicKeyCredential;
  return !!(browser.isSecureContext && browser.navigator?.credentials &&
    type?.parseCreationOptionsFromJSON && type?.parseRequestOptionsFromJSON &&
    typeof type.prototype.toJSON === "function");
}

export async function verifyWithDevice(gateway, payment, browser = globalThis) {
  if (!canUseTransferKey(browser)) throw Object.assign(new Error("transfer_key_unavailable"), {status: 428});
  const enroll = payment === null;
  const path = base + (enroll ? "/register" : "/payment");
  const {ceremony, publicKey} = await gateway.request(path + "/options", "POST", payment ?? {});
  const type = browser.PublicKeyCredential;
  let credential;
  try {
    credential = enroll
      ? await browser.navigator.credentials.create({publicKey: type.parseCreationOptionsFromJSON(publicKey)})
      : await browser.navigator.credentials.get({publicKey: type.parseRequestOptionsFromJSON(publicKey)});
  } catch (error) {
    if (!["NotAllowedError", "AbortError", "NotSupportedError", "SecurityError"].includes(error?.name)) throw error;
  }
  if (!credential) throw Object.assign(new Error("transfer_key_unconfirmed"), {status: 428});
  return gateway.request(path + "/finish", "POST", {ceremony, credential: credential.toJSON()});
}
