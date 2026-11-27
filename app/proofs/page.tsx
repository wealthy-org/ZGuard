import type { Metadata } from "next";
import { IS_MAINNET } from "@/lib/web3/network";
import ProofExplorer from "@/components/ProofExplorer";

export const metadata: Metadata = {
  title: IS_MAINNET ? "Settlement proof" : "Settlement proof preview",
  description: IS_MAINNET
    ? "Readable, policy-bound Perm settlement receipts decoded from PermRouter events on Robinhood Chain."
    : "A demonstration of readable, policy-bound Perm settlement receipts.",
};

export default function ProofsPage() {
  return <ProofExplorer />;
}
