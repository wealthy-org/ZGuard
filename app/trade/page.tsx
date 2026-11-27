import type { Metadata } from "next";
import { IS_MAINNET } from "@/lib/web3/network";
import TradeApp from "@/components/TradeApp";

export const metadata: Metadata = {
  title: IS_MAINNET ? "Router" : "Router preview",
  description: IS_MAINNET
    ? "Signed multi-venue swaps on Robinhood Chain with a transparent Perm fee rebate."
    : "Preview Perm route comparison and transparent fee rebate accounting.",
};

export default function TradePage() {
  return <TradeApp />;
}
