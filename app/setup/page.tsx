import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IS_MAINNET } from "@/lib/web3/network";
import DeploymentSetup from "@/components/DeploymentSetup";

export const metadata: Metadata = {
  title: "Testnet setup",
  description: "Deploy the Perm router and restricted v4 adapter from an owner-controlled browser wallet on Robinhood Chain Testnet.",
};

export default function SetupPage() {
  // Mainnet deployments are CLI-only (contracts/scripts/deploy-mainnet.cjs); never expose this tool.
  if (IS_MAINNET) notFound();
  return <DeploymentSetup />;
}
