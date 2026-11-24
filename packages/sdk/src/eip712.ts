import {
  encodeAbiParameters,
  keccak256,
  parseAbi,
  recoverTypedDataAddress,
  toHex,
  type Hex,
  type PublicClient,
} from "viem";
import {
  BASE_USDC_ASSETS,
  RHC_CANONICAL_ASSETS,
  RHC_MAINNET_CHAIN_ID,
  RHC_TESTNET_ASSETS,
  RHC_TESTNET_CHAIN_ID,
} from "./constants.js";
import type { Eip3009Authorization } from "./types.js";

export interface VerifiedEip712Domain {
  chainId: number;
  verifyingContract: `0x${string}`;
  name: string;
  version?: string;
  domainSeparator: `0x${string}`;
  supportsEip3009: boolean;
  verifiedAt: number;
}

const EIP712_DOMAIN_TYPEHASH_WITH_VERSION = keccak256(
  toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
);

const EIP712_DOMAIN_TYPEHASH_NO_VERSION = keccak256(
  toHex("EIP712Domain(string name,uint256 chainId,address verifyingContract)")
);

const domainRegistry = new Map<string, VerifiedEip712Domain>();

function domainKey(chainId: number, contract: string): string {
  return `${chainId}:${contract.toLowerCase()}`;
}

// Seed with USDG on RHC 4663 verified directly from live contract 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
domainRegistry.set(
  domainKey(RHC_MAINNET_CHAIN_ID, RHC_CANONICAL_ASSETS.USDG.address),
  {
    chainId: RHC_MAINNET_CHAIN_ID,
    verifyingContract: RHC_CANONICAL_ASSETS.USDG.address,
    name: RHC_CANONICAL_ASSETS.USDG.eip712Domain.name,
    version: RHC_CANONICAL_ASSETS.USDG.eip712Domain.version,
    domainSeparator: RHC_CANONICAL_ASSETS.USDG.eip712Domain.domainSeparator,
    supportsEip3009: true,
    verifiedAt: 0,
  }
);

// Seed with USDG on RHC 46630 Testnet verified directly from live contract 0x7E955252E15c84f5768B83c41a71F9eba181802F
domainRegistry.set(
  domainKey(RHC_TESTNET_CHAIN_ID, RHC_TESTNET_ASSETS.USDG.address),
  {
    chainId: RHC_TESTNET_CHAIN_ID,
    verifyingContract: RHC_TESTNET_ASSETS.USDG.address,
    name: RHC_TESTNET_ASSETS.USDG.eip712Domain.name,
    version: RHC_TESTNET_ASSETS.USDG.eip712Domain.version,
    domainSeparator: RHC_TESTNET_ASSETS.USDG.eip712Domain.domainSeparator,
    supportsEip3009: true,
    verifiedAt: 0,
  }
);

export function computeEip712DomainSeparator(params: {
  name: string;
  version?: string;
  chainId: number;
  verifyingContract: `0x${string}`;
}): `0x${string}` {
  if (params.version !== undefined) {
    return keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "address" },
        ],
        [
          EIP712_DOMAIN_TYPEHASH_WITH_VERSION,
          keccak256(toHex(params.name)),
          keccak256(toHex(params.version)),
          BigInt(params.chainId),
          params.verifyingContract,
        ]
      )
    );
  }
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        EIP712_DOMAIN_TYPEHASH_NO_VERSION,
        keccak256(toHex(params.name)),
        BigInt(params.chainId),
        params.verifyingContract,
      ]
    )
  );
}

export function registerVerifiedEip712Domain(domain: VerifiedEip712Domain): void {
  domainRegistry.set(domainKey(domain.chainId, domain.verifyingContract), domain);
}

export function getVerifiedEip712Domain(
  chainId: number,
  contract: string
): VerifiedEip712Domain | null {
  return domainRegistry.get(domainKey(chainId, contract)) ?? null;
}

/**
 * Reads EIP-712 domain directly from an installed on-chain contract (§2.1 & §6.1).
 * Never guesses a domain: verifies computed separator equals on-chain DOMAIN_SEPARATOR().
 */
export async function verifyContractEip712DomainOnchain(
  client: PublicClient,
  chainId: number,
  contractAddress: `0x${string}`
): Promise<VerifiedEip712Domain | null> {
  const abi = parseAbi([
    "function name() view returns (string)",
    "function version() view returns (string)",
    "function DOMAIN_SEPARATOR() view returns (bytes32)",
    "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
    "function RECEIVE_WITH_AUTHORIZATION_TYPEHASH() view returns (bytes32)",
    "function TRANSFER_WITH_AUTHORIZATION_TYPEHASH() view returns (bytes32)",
  ]);

  try {
    let supportsEip3009 = false;
    try {
      const [rxHash, txHash] = await Promise.all([
        client.readContract({
          address: contractAddress,
          abi,
          functionName: "RECEIVE_WITH_AUTHORIZATION_TYPEHASH",
        }),
        client.readContract({
          address: contractAddress,
          abi,
          functionName: "TRANSFER_WITH_AUTHORIZATION_TYPEHASH",
        }),
      ]);
      supportsEip3009 = Boolean(rxHash && txHash);
    } catch {
      supportsEip3009 = false;
    }

    // Try ERC-5267 eip712Domain() first
    try {
      const res = await client.readContract({
        address: contractAddress,
        abi,
        functionName: "eip712Domain",
      });
      const [, name, version, domainChainId, verifyingContract] = res;
      if (
        Number(domainChainId) === chainId &&
        verifyingContract.toLowerCase() === contractAddress.toLowerCase()
      ) {
        const domainSeparator = computeEip712DomainSeparator({
          name,
          version,
          chainId,
          verifyingContract: contractAddress,
        });
        const entry: VerifiedEip712Domain = {
          chainId,
          verifyingContract: contractAddress,
          name,
          version,
          domainSeparator,
          supportsEip3009,
          verifiedAt: Date.now(),
        };
        registerVerifiedEip712Domain(entry);
        return entry;
      }
    } catch {
      // Fallback to DOMAIN_SEPARATOR() + name() + candidate version match
    }

    const [onchainSeparator, contractName] = await Promise.all([
      client.readContract({
        address: contractAddress,
        abi,
        functionName: "DOMAIN_SEPARATOR",
      }),
      client.readContract({
        address: contractAddress,
        abi,
        functionName: "name",
      }),
    ]);

    let explicitVersion: string | undefined;
    try {
      explicitVersion = await client.readContract({
        address: contractAddress,
        abi,
        functionName: "version",
      });
    } catch {
      explicitVersion = undefined;
    }

    const candidates = explicitVersion
      ? [explicitVersion]
      : ["1", "2", "1.0", "0", undefined];

    for (const ver of candidates) {
      const computed = computeEip712DomainSeparator({
        name: contractName,
        version: ver,
        chainId,
        verifyingContract: contractAddress,
      });
      if (computed.toLowerCase() === onchainSeparator.toLowerCase()) {
        const entry: VerifiedEip712Domain = {
          chainId,
          verifyingContract: contractAddress,
          name: contractName,
          version: ver,
          domainSeparator: onchainSeparator,
          supportsEip3009,
          verifiedAt: Date.now(),
        };
        registerVerifiedEip712Domain(entry);
        return entry;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export const EIP3009_TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const EIP3009_RECEIVE_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * Cryptographically verifies an EIP-3009 signature if `authorization.signature` is supplied.
 */
export async function verifyEip3009Signature(
  auth: Eip3009Authorization,
  verifiedDomain: VerifiedEip712Domain
): Promise<boolean> {
  if (!auth.signature || !auth.nonce) return false;
  const primaryType = auth.kind ?? "TransferWithAuthorization";
  try {
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: verifiedDomain.name,
        ...(verifiedDomain.version !== undefined ? { version: verifiedDomain.version } : {}),
        chainId: verifiedDomain.chainId,
        verifyingContract: verifiedDomain.verifyingContract,
      },
      types: {
        [primaryType]: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType,
      message: {
        from: auth.from.toLowerCase() as Hex,
        to: auth.to.toLowerCase() as Hex,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter ?? 0),
        validBefore: BigInt(auth.validBefore ?? 0),
        nonce: auth.nonce as Hex,
      },
      signature: auth.signature as Hex,
    });
    return recovered.toLowerCase() === auth.from.toLowerCase();
  } catch {
    return false;
  }
}
