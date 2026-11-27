import type { Metadata } from "next";
import { IS_MAINNET } from "@/lib/web3/network";
import RebateCalculator from "@/components/RebateCalculator";

export const metadata: Metadata = {
  title: IS_MAINNET ? "Fee rebate" : "Fee rebate preview",
  description: IS_MAINNET
    ? "The active Perm fee policy read from PermRouter: gross platform fee, fee rebate and net fee."
    : "Explore the illustrative accounting for Perm's router-level platform fee rebate.",
};

export default function RebatePage() {
  return <RebateCalculator />;
}
