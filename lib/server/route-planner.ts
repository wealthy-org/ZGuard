export type RoutingToken = { address: string };
export type RoutingStep = { amountOut: string };
export type ProviderRoute = { routeKind: string; steps: readonly { providerId: string }[] };

/** v3-style provider ids: Synthra v3 on testnet, canonical Uniswap v3 on mainnet. Kept inline
 * (not imported from network.ts) so this module stays pure for scripts/test-route-planner.ts. */
const V3_STYLE_PROVIDERS = new Set(["SYNTHRA_V3", "UNISWAP_V3"]);

export function isExplicitV4V3Route(candidate: ProviderRoute): boolean {
  const providers = [...new Set(candidate.steps.map((step) => step.providerId))];
  return candidate.routeKind === "cross-venue"
    && candidate.steps.length === 2
    && providers.length === 2
    && providers.includes("UNISWAP_V4_DIRECT")
    && providers.some((provider) => V3_STYLE_PROVIDERS.has(provider));
}

type TwoStepOptions<TToken extends RoutingToken, TStep extends RoutingStep, TCandidate> = {
  tokens: readonly TToken[];
  input: TToken;
  output: TToken;
  amountIn: bigint;
  edges: (input: TToken, output: TToken, amount: bigint) => Promise<TStep[]>;
  buildCandidate: (steps: [TStep, TStep]) => Promise<TCandidate>;
  maxIntermediates?: number;
  maxFirstLegs?: number;
  maxSecondLegs?: number;
  concurrency?: number;
};

export async function mapLimited<T, R>(items: readonly T[], concurrency: number, operation: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error("Route-search concurrency must be between 1 and 32");
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await operation(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function topByOutput<T extends RoutingStep>(steps: readonly T[], limit: number): T[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 16) throw new Error("Route-search leg limit must be between 1 and 16");
  return [...steps].sort((left, right) => {
    const a = BigInt(left.amountOut);
    const b = BigInt(right.amountOut);
    return b > a ? 1 : b < a ? -1 : 0;
  }).slice(0, limit);
}

export async function discoverTwoStepRoutes<TToken extends RoutingToken, TStep extends RoutingStep, TCandidate>({
  tokens,
  input,
  output,
  amountIn,
  edges,
  buildCandidate,
  maxIntermediates = 16,
  maxFirstLegs = 2,
  maxSecondLegs = 3,
  concurrency = 3,
}: TwoStepOptions<TToken, TStep, TCandidate>): Promise<TCandidate[]> {
  if (!Number.isInteger(maxIntermediates) || maxIntermediates < 1 || maxIntermediates > 32) {
    throw new Error("Route-search intermediate limit must be between 1 and 32");
  }
  const excluded = new Set([input.address.toLowerCase(), output.address.toLowerCase()]);
  const seen = new Set<string>();
  const intermediates = tokens.filter((token) => {
    const address = token.address.toLowerCase();
    if (excluded.has(address) || seen.has(address)) return false;
    seen.add(address);
    return true;
  }).slice(0, maxIntermediates);

  const groups = await mapLimited(intermediates, concurrency, async (intermediate) => {
    const firstLegs = topByOutput(await edges(input, intermediate, amountIn), maxFirstLegs);
    const routes = await mapLimited(firstLegs, Math.min(2, concurrency), async (first) => {
      const secondLegs = topByOutput(await edges(intermediate, output, BigInt(first.amountOut)), maxSecondLegs);
      return Promise.all(secondLegs.map((second) => buildCandidate([first, second])));
    });
    return routes.flat();
  });
  return groups.flat();
}
