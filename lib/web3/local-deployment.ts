"use client";

import { useEffect, useState } from "react";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import {
  PERM_ROUTER_ADDRESS,
  PERM_V3_ADAPTER_ADDRESS,
  PERM_V4_ADAPTER_ADDRESS,
  PERMIT2_ADDRESS,
  ALLOWLISTED_STAGING_BUILD,
  DEPLOYMENT_MODE,
  DEPLOYMENT_READY,
  IS_MAINNET,
  PERM_CHAIN_ID,
  ROUTER_VERSION,
  STAGING_DEPLOYMENT_CONFIGURED,
  STAGING_E2E_DECLARED,
} from "./config";

export type LocalPermDeployment = {
  chainId: number;
  routerVersion: 2;
  permRouter: Address;
  v4Adapter: Address;
  v3Adapter: Address;
  permit2: Address;
  quoteSigner: Address;
  owner: Address;
  treasury: Address;
  pauseGuardian: Address;
  deploymentBlock: string;
  deploymentTransactions: Hex[];
  generatedAt: string;
  source: "browser-wallet";
};

const STORAGE_KEY = `perm:${PERM_CHAIN_ID}-deployment:v2`;
const CHANGE_EVENT = "perm-deployment-change";
// Browser-wallet deployment overrides are a local testnet convenience only. A mainnet build always
// trusts the committed manifest / reviewed env addresses and never localStorage.
export const LOCAL_DEPLOYMENT_ENABLED = process.env.NODE_ENV !== "production" && !IS_MAINNET;

export function readLocalDeployment(): LocalPermDeployment | undefined {
  if (!LOCAL_DEPLOYMENT_ENABLED || typeof window === "undefined") return undefined;
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as LocalPermDeployment | null;
    if (
      !value || value.chainId !== PERM_CHAIN_ID || value.routerVersion !== 2
      || !isAddress(value.permRouter) || !isAddress(value.v4Adapter) || !isAddress(value.v3Adapter)
      || !isAddress(value.permit2) || !isAddress(value.quoteSigner) || !isAddress(value.owner)
      || !isAddress(value.treasury) || !isAddress(value.pauseGuardian)
    ) return undefined;
    return {
      ...value,
      permRouter: getAddress(value.permRouter),
      v4Adapter: getAddress(value.v4Adapter),
      v3Adapter: getAddress(value.v3Adapter),
      permit2: getAddress(value.permit2),
      quoteSigner: getAddress(value.quoteSigner),
      owner: getAddress(value.owner),
      treasury: getAddress(value.treasury),
      pauseGuardian: getAddress(value.pauseGuardian),
    };
  } catch {
    return undefined;
  }
}

export function saveLocalDeployment(value: LocalPermDeployment) {
  if (!LOCAL_DEPLOYMENT_ENABLED) throw new Error("Browser deployment overrides are disabled in production");
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearLocalDeployment() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function usePermDeployment() {
  const [local, setLocal] = useState<LocalPermDeployment>();
  useEffect(() => {
    if (!LOCAL_DEPLOYMENT_ENABLED) return;
    const read = () => setLocal(readLocalDeployment());
    read();
    window.addEventListener(CHANGE_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(CHANGE_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  const router = local?.permRouter || PERM_ROUTER_ADDRESS;
  const v4Adapter = local?.v4Adapter || PERM_V4_ADAPTER_ADDRESS;
  const v3Adapter = local?.v3Adapter || PERM_V3_ADAPTER_ADDRESS;
  const version = local?.routerVersion || ROUTER_VERSION;
  const permit2 = local?.permit2 || PERMIT2_ADDRESS;
  const ready = local ? Boolean(router && v4Adapter && version >= 2) : DEPLOYMENT_READY;
  return {
    router,
    adapter: v4Adapter,
    v4Adapter,
    v3Adapter,
    permit2,
    version,
    local,
    ready,
    mode: local ? "local-development" as const : DEPLOYMENT_MODE,
    allowlistedStaging: !local && ALLOWLISTED_STAGING_BUILD,
    stagingConfigured: !local && STAGING_DEPLOYMENT_CONFIGURED,
    stagingE2eDeclared: !local && STAGING_E2E_DECLARED,
    source: local ? "browser" as const : router ? "manifest" as const : "none" as const,
  };
}
