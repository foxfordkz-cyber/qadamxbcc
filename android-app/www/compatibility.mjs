// Protocol discovery is optional on legacy servers. A declared newer major is not.
export function protocolCompatibility(value, build = null) {
  if (!value || typeof value !== "object" || !Number.isInteger(value.api_major) ||
      !Number.isInteger(value.minimum_android_build) || value.minimum_android_build < 0)
    return "invalid";
  if (value.api_major !== 1) return "update_required";
  if (Number.isInteger(build) && build < value.minimum_android_build) return "update_required";
  return "supported";
}

export async function checkProtocol(gateway, build = null) {
  try {
    const result = protocolCompatibility(await gateway.request("/compatibility"), build);
    // No secrets or configurable URL is accepted from this discovery response.
    return result;
  } catch (error) {
    if (error.status === 404 || error.status === 405) return "legacy";
    throw error;
  }
}
