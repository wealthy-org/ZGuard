export const WALLETCONNECT_REQUIRED_METHODS = [
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData_v4",
] as const;

export const WALLETCONNECT_EIP155_METHODS = [
  ...WALLETCONNECT_REQUIRED_METHODS,
  "eth_sign",
  "eth_signTypedData",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
] as const;

export function walletConnectSessionHasRequiredMethods(namespaces: unknown): boolean {
  if (!namespaces || typeof namespaces !== "object" || Array.isArray(namespaces)) return false;
  const methods = new Set<string>();
  for (const [key, namespace] of Object.entries(namespaces)) {
    if (key !== "eip155" && !key.startsWith("eip155:")) continue;
    if (!namespace || typeof namespace !== "object" || Array.isArray(namespace)) continue;
    const candidateMethods = (namespace as { methods?: unknown }).methods;
    if (!Array.isArray(candidateMethods)) continue;
    for (const method of candidateMethods) if (typeof method === "string") methods.add(method);
  }
  return WALLETCONNECT_REQUIRED_METHODS.every((method) => methods.has(method));
}

export function parseEip155ChainId(value: unknown): number | undefined {
  let reference: string;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value === "bigint") {
    return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
  }
  if (typeof value !== "string") return undefined;

  reference = value.trim();
  if (reference.toLowerCase().startsWith("eip155:")) reference = reference.slice("eip155:".length);

  let parsed: number;
  if (/^0x[0-9a-f]+$/i.test(reference)) parsed = Number.parseInt(reference.slice(2), 16);
  else if (/^[0-9]+$/.test(reference)) parsed = Number(reference);
  else return undefined;

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
