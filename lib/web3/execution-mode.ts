export const ALLOWLISTED_STAGING_MODE = "allowlisted-testnet-staging";
/** Mainnet counterpart: only allowlisted wallets get signed quotes; remote signer custody is mandatory. */
export const ALLOWLISTED_MAINNET_MODE = "allowlisted-mainnet";
export const ROBINHOOD_TESTNET_CHAIN_ID = 46_630;
export const ROBINHOOD_MAINNET_CHAIN_ID = 4_663;

export type AllowlistedMode = typeof ALLOWLISTED_STAGING_MODE | typeof ALLOWLISTED_MAINNET_MODE;

/** Which allowlisted mode a build for `NEXT_PUBLIC_PERM_CHAIN_ID` must use. */
export function allowlistedModeForChain(publicChainId: string | undefined): { mode: AllowlistedMode; chainId: number; mainnet: boolean } {
  const mainnet = publicChainId === String(ROBINHOOD_MAINNET_CHAIN_ID);
  return mainnet
    ? { mode: ALLOWLISTED_MAINNET_MODE, chainId: ROBINHOOD_MAINNET_CHAIN_ID, mainnet }
    : { mode: ALLOWLISTED_STAGING_MODE, chainId: ROBINHOOD_TESTNET_CHAIN_ID, mainnet };
}
