import type { Metadata } from "next";
import { IS_MAINNET } from "@/lib/web3/network";
import RouteExplorer from "@/components/RouteExplorer";

export const metadata: Metadata = {
  title: "Route explorer",
  description: IS_MAINNET
    ? "Live Perm route comparison across Uniswap v4 and Uniswap v3 on Robinhood Chain."
    : "Illustrative Perm route comparison fixtures for direct venues and verified hook candidates.",
};

export default function RoutesPage() {
  return <RouteExplorer />;
}
