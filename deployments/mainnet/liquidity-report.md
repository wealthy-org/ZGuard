# Robinhood Chain mainnet liquidity report

Generated 2026-11-23T03:06:19.318Z · chain 4663 · block 121089419 · gas 0.0200 gwei
Nominal: 0.001 ETH (routed after 0.15% net Perm fee: 0.0009985 ETH). Read-only; no transaction sent.

## Dependencies

| Contract | Address | Code |
|---|---|---|
| Uniswap v4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | ✅ |
| Uniswap v4 V4Quoter | `0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94` | ✅ |
| Uniswap v4 StateView | `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b` | ✅ |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | ✅ |
| WETH9 | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | ✅ |
| Uniswap V3 Factory | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` | ✅ |
| Uniswap V3 SwapRouter02 | `0xCaf681a66D020601342297493863E78C959E5cb2` | ✅ |
| Uniswap V3 QuoterV2 | `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` | ✅ |

## Synthra V3 on mainnet

| Check | Address | Code |
|---|---|---|
| Synthra factory (testnet address) | `0x911b4000D3422F482F4062a913885f7b035382Df` | ❌ none |
| Synthra SwapRouter02 (testnet address) | `0x3Ce954107b1A675826B33bF23060Dd655e3758fE` | ❌ none |
| Synthra QuoterV2 (testnet address) | `0x231606c321A99DE81e28fE48B07a93F1ba49e713` | ❌ none |
| Synthra factory (DefiLlama registry address) | `0x6307fc239C7964942c1BfFE51930E55606619c74` | ✅ |

**No Synthra WETH pool for the stock tokens on 4663 → Synthra must not be recorded or claimed on mainnet.**

## Stock tokens

Perm-usable = hookless pool, native-ETH side for v4 (PermV4Adapter routes ETH as currency 0x0), quote succeeds, price impact ≤ 3% and round trip loss < 5%.

| Token | Venue | Fee | ETH side | Buy out (0.001 ETH) | Impact | Round-trip loss | Perm-usable |
|---|---|---:|---|---:|---:|---:|---|
| NVDA | uniswap-v4 | 5% | native | 0.011868797 | 0.00% | 10.20% | ❌ |
| NVDA | uniswap-v4 | 4% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.3% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 80% | native | 0.0016749571 | 2.38% | 96.13% | ❌ |
| NVDA | uniswap-v4 | 3.9% | native | 0.011704715 | 3.79% | 14.76% | ❌ |
| NVDA | uniswap-v4 | 79% | native | 0.0012485934 | 0.53% | 95.64% | ❌ |
| NVDA | uniswap-v4 | 93% | native | 0.00083662338 | 0.14% | 99.51% | ❌ |
| NVDA | uniswap-v4 | 0.01% | native | 0.011704351 | 9.23% | 17.31% | ❌ |
| NVDA | uniswap-v4 | 1% | native | 0.012674303 | 0.06% | 2.61% | ✅ |
| NVDA | uniswap-v4 | 99.9798% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 99.8623% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 85% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 95% | native | 0.000845491 | 13.14% | 99.78% | ❌ |
| NVDA | uniswap-v4 | 0.05% | native | 0.012939692 | 0.00% | 0.42% | ✅ |
| NVDA | uniswap-v4 | 99.8% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 97.654% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.268% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.265% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.0488% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.0499% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.0489% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.0498% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 97.369% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 5.095% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.0625% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 4% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x8312…) | 0% | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x739E…) | 0.15% | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xc4D5…) | 0.15% | native | — | — | — | ❌ |
| NVDA | uniswap-v4 | 90.65% | native | 0.00070069757 | 2.22% | 99.15% | ❌ |
| NVDA | uniswap-v4 (hook 0xB572…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x5DcC…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xC09f…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x9715…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x4FDF…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x23C0…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xaFbA…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xc24f…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xFf64…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x1fc1…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x8d98…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xaF07…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xCDC8…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x23D5…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x44C4…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3457…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x2221…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xd52f…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xaeed…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xE855…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x7aAC…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xa11D…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xed82…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x0F6c…) | 0% | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x1e27…) | 0% | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xb284…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xa146…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xa146…) | 0.0075% | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xD33c…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xE7b5…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xD33c…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x0e2a…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xB00A…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x05E2…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x2e46…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3a21…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x451a…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xa4B4…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x2404…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x2D66…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xe813…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x4255…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xCB1a…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xCB1a…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xCB1a…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xCB1a…) | 0.0001% | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xe37A…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 | 80% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x6D2a…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x6D2a…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 | 99% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.4321% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xEf11…) | 0.01% | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xd9C8…) | 0.025% | native | — | — | — | ❌ |
| NVDA | uniswap-v4 | 0.4322% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 14% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x607a…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 | 8% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 | 0.1% | native | 0.012863077 | 0.37% | 1.28% | ✅ |
| NVDA | uniswap-v4 (hook 0xCca2…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xdce6…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xdce6…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3857…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 | 10% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 44% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x5405…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 | 0.03% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xb8dC…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 | 45% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 77% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.44% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 4.44% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.33% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.049% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x104a…) | 0% | native | — | — | — | ❌ |
| NVDA | uniswap-v4 | 0.2999% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 3% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3cad…) | 0% | native | — | — | — | ❌ |
| NVDA | uniswap-v4 | 50% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x884c…) | 0% | native | — | — | — | ❌ |
| NVDA | uniswap-v4 | 78.9% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.0075% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.25% | native | 0.012930143 | 0.00% | 0.87% | ✅ |
| NVDA | uniswap-v4 | 49% | native | 0.0067284043 | 2.42% | 75.06% | ❌ |
| NVDA | uniswap-v4 | 10% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 4% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 4.0001% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 1.0001% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 5% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 5.0001% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 5.0002% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 5.0003% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 5.0004% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 5.0005% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 5.0006% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.99% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 98.8% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x4739…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3351…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x961e…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x93B0…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x9166…) | dynamic | native | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x2a8d…) | 1% | native | — | — | — | ❌ |
| NVDA | uniswap-v4 | 40.911% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 | 0.04% | native | error | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xF4F6…) | 5% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x4CaF…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xFedA…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3345…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x77af…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xb381…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x963C…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x58B8…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xA7CD…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3457…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x9943…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x0372…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x57A6…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x159B…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x43B3…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x864e…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x643e…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xC3CD…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xD746…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xefE9…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x435f…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3cE0…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x6C97…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xa01C…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x8b24…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x63d1…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xEe6d…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x0788…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x948f…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xe25f…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x9e03…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x490F…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x1732…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xD42B…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xD3C7…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xfBc5…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xB9e0…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x4Acd…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x1bbE…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xaef1…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x4836…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xd48F…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x2b70…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xAF07…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xA218…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xB525…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xcE3F…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xf869…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xb112…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x662e…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x839C…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x5FFb…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x8834…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x4A6C…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x1bf8…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x0723…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x4097…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xbf85…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xbeF3…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x14F3…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x617B…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x4F6b…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x4302…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x703b…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xF098…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xE65e…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3E75…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xf4f4…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xB8fb…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xFf5a…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x5F78…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x2D00…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xad2E…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x36fD…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x7360…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x8fDA…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x9685…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x07Fd…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x023d…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xb649…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xc74A…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x0723…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x8DC6…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x4957…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x43E1…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x9b23…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x1AFf…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x824d…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x9002…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x6ECB…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xb958…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x2f9a…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 | 0.1% | weth | 0.012940512 | 0.00% | 0.54% | ❌ |
| NVDA | uniswap-v4 (hook 0x65d9…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x2bA9…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xAA14…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x38Dd…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xF917…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x9F0C…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xDbDC…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x35DA…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x286b…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x2140…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xAC29…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xc3E4…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x86D9…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3d3E…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xD21A…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xf026…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 | 0.25% | weth | error | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x35a8…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xA90d…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xE6FA…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x6B8e…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xF7C1…) | 0.1% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xA7CE…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3812…) | 0.05% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xDe24…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xd5b0…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x2e78…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x78a4…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xD608…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xA6c9…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x5E50…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x6514…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x991D…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x991D…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x84B9…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x7f50…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x7f50…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xE42B…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xaE5c…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x7002…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xF0ed…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x7002…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3857…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x885F…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xE42B…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xdce6…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xdce6…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x7002…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x7002…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x7002…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3857…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3857…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x7002…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xdce6…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x7002…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3857…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x400E…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xE42B…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x0f55…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x7f50…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xE218…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 | 43% | weth | error | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x84B9…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xFb86…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xE300…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xE300…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xFb86…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3c0C…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3D77…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xE368…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xE368…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xbD8a…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xE368…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x9a8A…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x48B8…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x9c66…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xc60B…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xe449…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xf6be…) | 0% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x1133…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x05cb…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xe449…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xa735…) | 0.02% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x3493…) | 0.02% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x419e…) | 0.02% | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xA117…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0xA13F…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v4 (hook 0x4512…) | dynamic | weth | — | — | — | ❌ |
| NVDA | uniswap-v3 | 0.01% | WETH | error | — | — | ❌ |
| NVDA | uniswap-v3 | 0.05% | WETH | 0.012958891 | 0.00% | 0.39% | ✅ |
| NVDA | uniswap-v3 | 0.3% | WETH | 0.012934053 | 0.00% | 0.89% | ✅ |
| NVDA | uniswap-v3 | 1% | WETH | 0.012495184 | 1.73% | 5.62% | ❌ |
| AAPL | uniswap-v4 | 5% | native | 0.0044510605 | 0.06% | 10.31% | ❌ |
| AAPL | uniswap-v4 | 3% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 1% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 85% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 99.8% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 99.9798% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 97.654% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 99.8557% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 95% | native | 0.0015247058 | 25.53% | 99.81% | ❌ |
| AAPL | uniswap-v4 | 90% | native | 0.0010655639 | 7.03% | 99.08% | ❌ |
| AAPL | uniswap-v4 | 0.2% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 92% | native | 0.000076827999 | 38.80% | 99.62% | ❌ |
| AAPL | uniswap-v4 (hook 0x8312…) | 0% | native | — | — | — | ❌ |
| AAPL | uniswap-v4 | 0.9% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 96.65% | native | 0.000046384975 | 3.87% | 99.89% | ❌ |
| AAPL | uniswap-v4 | 0.25% | native | 0.0037256132 | 23.02% | 37.96% | ❌ |
| AAPL | uniswap-v4 | 0.4321% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 0.4322% | native | 0.004507148 | 6.62% | 13.65% | ❌ |
| AAPL | uniswap-v4 (hook 0x991D…) | dynamic | native | — | — | — | ❌ |
| AAPL | uniswap-v4 | 8% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 0.8% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 92.009% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 10% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 70% | native | 0.0022712992 | 0.73% | 91.13% | ❌ |
| AAPL | uniswap-v4 | 4.8% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 0.15% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 0.08% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 5% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 5.0001% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 5.0002% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 5.0003% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 5.0004% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 5.0005% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 | 5.0006% | native | error | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x57A6…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x3feB…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x8fD5…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xE8EA…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x4A8D…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xC900…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xC7Fb…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xCDE7…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x7B56…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xe189…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xC5e6…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xEcA8…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xf7e5…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x054D…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x33d6…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x4131…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xC6EC…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x910e…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xaA68…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xaA68…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xaA68…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x0723…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xf869…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x0723…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 | 80% | weth | error | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xd5b0…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x2e78…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x84B9…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x84B9…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xbD8a…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xbD8a…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xE300…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xc60B…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x05cb…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xB932…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xa735…) | 0.1% | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x3493…) | 0.1% | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x419e…) | 0.1% | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0x9585…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v4 (hook 0xA13F…) | dynamic | weth | — | — | — | ❌ |
| AAPL | uniswap-v3 | 0.01% | WETH | error | — | — | ❌ |
| AAPL | uniswap-v3 | 0.05% | WETH | 0.0048675795 | 0.00% | 0.39% | ✅ |
| AAPL | uniswap-v3 | 0.3% | WETH | error | — | — | ❌ |
| TSLA | uniswap-v4 | 5% | native | 0.0044119468 | 0.00% | 10.20% | ❌ |
| TSLA | uniswap-v4 | 4% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 66% | native | 0.0018570901 | 17.68% | 91.09% | ❌ |
| TSLA | uniswap-v4 | 85% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 98.765% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 99.9798% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 1% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 95% | native | 0.00041754294 | 16.11% | 99.79% | ❌ |
| TSLA | uniswap-v4 | 2.5% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 5.095% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x64b1…) | 0.15% | native | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x6eD0…) | 0.15% | native | — | — | — | ❌ |
| TSLA | uniswap-v4 | 90.65% | native | 0.000059202216 | 11.32% | 99.23% | ❌ |
| TSLA | uniswap-v4 (hook 0xb284…) | dynamic | native | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0xC0d5…) | 0% | native | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0xe37A…) | dynamic | native | — | — | — | ❌ |
| TSLA | uniswap-v4 | 80% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 0.4321% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 99% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 0.4322% | native | 0.0044099689 | 7.01% | 14.34% | ❌ |
| TSLA | uniswap-v4 | 6.9999% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 70% | native | 0.0016484119 | 0.63% | 91.11% | ❌ |
| TSLA | uniswap-v4 | 4.5% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0xE300…) | dynamic | native | — | — | — | ❌ |
| TSLA | uniswap-v4 | 0.02% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 0.25% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 0.0375% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 65.9% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 0.2% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 0.18% | native | 0.0047482321 | 0.03% | 0.78% | ✅ |
| TSLA | uniswap-v4 | 98.8% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 0.288% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 0.6677% | native | error | — | — | ❌ |
| TSLA | uniswap-v4 | 98.99% | native | 0.000056608993 | 0.25% | 99.98% | ❌ |
| TSLA | uniswap-v4 (hook 0xF4F6…) | 5% | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x4b32…) | 0.3% | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0xE218…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x24CD…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x3D77…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x3c0C…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x3c0C…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0xE300…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x3D77…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x3D77…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x7d82…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x171f…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x3c0C…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0xFb86…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x64Da…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x171f…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0xB932…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x9585…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v4 (hook 0x4512…) | dynamic | weth | — | — | — | ❌ |
| TSLA | uniswap-v3 | 0.3% | WETH | 0.0047458224 | 0.00% | 0.89% | ✅ |
| AMZN | uniswap-v4 | 1% | native | 0.000001178052 | 98.98% | 99.99% | ❌ |
| AMZN | uniswap-v4 | 5% | native | error | — | — | ❌ |
| AMZN | uniswap-v4 | 60% | native | error | — | — | ❌ |
| AMZN | uniswap-v4 | 85% | native | error | — | — | ❌ |
| AMZN | uniswap-v4 | 5.095% | native | 0.0062126478 | 0.11% | 10.58% | ❌ |
| AMZN | uniswap-v4 | 89.99% | native | 0.00057927193 | 64.26% | 99.67% | ❌ |
| AMZN | uniswap-v4 | 0.3% | native | error | — | — | ❌ |
| AMZN | uniswap-v4 | 97.0027% | native | error | — | — | ❌ |
| AMZN | uniswap-v4 | 0.25% | native | error | — | — | ❌ |
| AMZN | uniswap-v4 | 4.99% | native | error | — | — | ❌ |
| AMZN | uniswap-v4 | 70% | native | 0.0028612383 | 0.73% | 91.13% | ❌ |
| AMZN | uniswap-v4 | 4.9% | native | error | — | — | ❌ |
| AMZN | uniswap-v4 | 0.9% | native | error | — | — | ❌ |
| AMZN | uniswap-v4 | 0.5% | native | error | — | — | ❌ |
| AMZN | uniswap-v4 | 0.299% | native | 0.0066667811 | 0.02% | 1.04% | ✅ |
| AMZN | uniswap-v4 | 80% | weth | error | — | — | ❌ |
| AMZN | uniswap-v3 | 0.3% | WETH | error | — | — | ❌ |
| AMZN | uniswap-v3 | 1% | WETH | error | — | — | ❌ |
| SPCX | uniswap-v4 | 1% | native | 0.012908783 | 0.00% | 2.48% | ✅ |
| SPCX | uniswap-v4 | 5% | native | 0.011979896 | 0.02% | 10.25% | ❌ |
| SPCX | uniswap-v4 | 0.3% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 93% | native | 0.0013588617 | 0.14% | 99.51% | ❌ |
| SPCX | uniswap-v4 | 80% | native | 0.0021604722 | 0.53% | 96.04% | ❌ |
| SPCX | uniswap-v4 | 85% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 99.9798% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 97.654% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 0.25% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 0.26% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 0.245% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 95% | native | 0.0010099186 | 13.43% | 99.78% | ❌ |
| SPCX | uniswap-v4 | 93.027% | native | 0.00000052768923 | 98.92% | 99.99% | ❌ |
| SPCX | uniswap-v4 (hook 0x8312…) | 0% | native | — | — | — | ❌ |
| SPCX | uniswap-v4 | 0.24% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 0.3% | native | 0.012978719 | 0.00% | 1.00% | ✅ |
| SPCX | uniswap-v4 | 99.65% | native | 0.0010902278 | 6.46% | 99.99% | ❌ |
| SPCX | uniswap-v4 | 65% | native | 0.008586263 | 9.14% | 89.28% | ❌ |
| SPCX | uniswap-v4 | 0.3499% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x9D2F…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xE18e…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x0B0C…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xc5B8…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xB591…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xf474…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xAd33…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xa2AE…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x8893…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xB783…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xE889…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xC98c…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x1793…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xA7A5…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xbFFB…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x2870…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x0824…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xa404…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x34A4…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x76C7…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x7c00…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x94D3…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xD25E…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xB8Ee…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x66d0…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x0B85…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x8625…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xCd54…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3EF5…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xA67f…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x87c0…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x4c49…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x000e…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x9E39…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x78AA…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xEa94…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x5BF9…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x4E07…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3682…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x0981…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xbbc2…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xff3b…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xf2f2…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xF49F…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xf3F3…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xF655…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x2C14…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x995b…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xaaa1…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x4cb5…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x6fd0…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x1972…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xeB46…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xb575…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xe45A…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x23B2…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x0592…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3cDA…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x8cf8…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x81a0…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x5131…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x91fA…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xbc2C…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xE44E…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x292c…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x257d…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xd2A0…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xD3C8…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x9bdc…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x6645…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x1A8B…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xe456…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x62de…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x4AFd…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xAD54…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x816f…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3A1A…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x40CA…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xa72D…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xdEA9…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x35E9…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xA530…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xB9FF…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x8b90…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xd60e…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xBFa2…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xa119…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3262…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x176b…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x741d…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x1E05…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x6a1D…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x8F5B…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x62FF…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x9a9b…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xfeb9…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xc3c1…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xB5aA…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xb1e0…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xE1c5…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xcc3D…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xBe2D…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x4AA1…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xb1D6…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 | 97.4966% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 80% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xcFce…) | 0.01% | native | — | — | — | ❌ |
| SPCX | uniswap-v4 | 99% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xEf11…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 | 10% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 70% | native | 0.0049482805 | 0.18% | 91.06% | ❌ |
| SPCX | uniswap-v4 | 0.2555% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 4.8% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x09bF…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x17FD…) | 0% | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xd9F7…) | 0% | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x64Da…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x64Da…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3D77…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3D77…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x0Aa5…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 | 40.09% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x5bBB…) | 0.25% | native | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xAf23…) | dynamic | native | — | — | — | ❌ |
| SPCX | uniswap-v4 | 64.99% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 0.21% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 2.45% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 0.67% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 0.0375% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 | 0.5% | native | error | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3f30…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x5ee1…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x5ee1…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x5ee1…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x0Ddc…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x609E…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xD2D9…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xd31D…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x6C52…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xC53E…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x72AB…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xf579…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xa71a…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x477F…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x1e15…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xE728…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xC882…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xED91…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x1312…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xade9…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xefB2…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x40df…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3868…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3d50…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x9E24…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x1363…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x7A2f…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xc022…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xEC0d…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x864F…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x62eF…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xeeB5…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x6BbB…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xB593…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x7a39…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xcc5b…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xa0A8…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xE1b2…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xF5Fc…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xc680…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x1f8b…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x2Ec9…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x69Fc…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3a9A…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x702c…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xAA02…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xaA77…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x35A6…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x9945…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xB169…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xeC81…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xde92…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xE446…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x945F…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xB546…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x22AC…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x78d6…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x30B7…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x7559…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x664b…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3a05…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x8b90…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xc3c2…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x57A6…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xffcA…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x8693…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x2564…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xE7D2…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x6397…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xc43F…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x4D22…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x6e54…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xC0d5…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x57A6…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x5557…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xB895…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x88B9…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x60B5…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x62c9…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x2966…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xc63D…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x0fB9…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xEF93…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x061E…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xE252…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xb5D5…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x7dD0…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x6e6A…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x293b…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3149…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x09CD…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x8275…) | 0% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xF09F…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x0D9E…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3133…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x69ff…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xC0d5…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xeD2E…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xa69B…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x49D3…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x051d…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x1f00…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x0890…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x33d2…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x26d7…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x656d…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xcdF7…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x8fa4…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3e02…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xAfE6…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xB7dC…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x662e…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3688…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xeD51…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x7f58…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x8362…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x84F0…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x0723…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 | 0.25% | weth | error | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x8DC6…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x4021…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xd5b0…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x2e78…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x84B9…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x84B9…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x24CD…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x24CD…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xbD8a…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x03ac…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xbD8a…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xFb86…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3c0C…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xEb4f…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x7d82…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x48B8…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x9a8A…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xc60B…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x05cb…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xB932…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xa735…) | 0.1% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x3493…) | 0.1% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x419e…) | 0.1% | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0x9585…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v4 (hook 0xA13F…) | dynamic | weth | — | — | — | ❌ |
| SPCX | uniswap-v3 | 0.01% | WETH | error | — | — | ❌ |
| SPCX | uniswap-v3 | 0.05% | WETH | 0.013037565 | 0.00% | 0.39% | ✅ |
| SPCX | uniswap-v3 | 0.3% | WETH | error | — | — | ❌ |
| SPCX | uniswap-v3 | 1% | WETH | error | — | — | ❌ |
| PLTR | uniswap-v4 | 1% | native | 0.000020871436 | 98.85% | 99.92% | ❌ |
| PLTR | uniswap-v4 | 8% | native | error | — | — | ❌ |
| PLTR | uniswap-v4 | 80% | native | error | — | — | ❌ |
| PLTR | uniswap-v4 | 5% | native | 0.010671902 | 0.01% | 10.23% | ❌ |
| PLTR | uniswap-v4 | 85% | native | error | — | — | ❌ |
| PLTR | uniswap-v4 | 99.8% | native | error | — | — | ❌ |
| PLTR | uniswap-v4 | 95% | native | 0.0013019093 | 15.63% | 99.79% | ❌ |
| PLTR | uniswap-v4 | 80% | native | error | — | — | ❌ |
| PLTR | uniswap-v4 | 0.4321% | native | error | — | — | ❌ |
| PLTR | uniswap-v4 | 0.4322% | native | 0.011001551 | 4.46% | 7.31% | ❌ |
| PLTR | uniswap-v4 | 5.0095% | native | error | — | — | ❌ |
| PLTR | uniswap-v4 | 4.99% | native | error | — | — | ❌ |
| PLTR | uniswap-v4 | 4% | native | 0.00025954578 | 97.21% | 99.14% | ❌ |
| PLTR | uniswap-v4 | 0.25% | native | error | — | — | ❌ |
| PLTR | uniswap-v4 (hook 0x3c0C…) | dynamic | weth | — | — | — | ❌ |
| PLTR | uniswap-v3 | 0.3% | WETH | 0.011476361 | 0.00% | 0.90% | ✅ |
| NFLX | uniswap-v4 | 1% | native | 0.000017219469 | 98.94% | 99.97% | ❌ |
| NFLX | uniswap-v4 | 0.01% | native | 0.0000079363424 | 98.98% | 99.99% | ❌ |
| NFLX | uniswap-v4 | 5% | native | 0.027141078 | 0.01% | 10.22% | ❌ |
| NFLX | uniswap-v4 | 85% | native | error | — | — | ❌ |
| NFLX | uniswap-v4 | 97.654% | native | error | — | — | ❌ |
| NFLX | uniswap-v4 | 4.85% | native | error | — | — | ❌ |
| NFLX | uniswap-v4 | 89.99% | native | 0.0010757748 | 54.00% | 99.57% | ❌ |
| NFLX | uniswap-v4 | 80% | native | error | — | — | ❌ |
| NFLX | uniswap-v4 | 4.5% | native | error | — | — | ❌ |
| NFLX | uniswap-v4 | 4.88% | native | error | — | — | ❌ |
| NFLX | uniswap-v4 | 70% | native | 0.0089091573 | 0.30% | 91.08% | ❌ |
| NFLX | uniswap-v4 | 3% | native | error | — | — | ❌ |
| NFLX | uniswap-v4 | 5% | native | error | — | — | ❌ |
| NFLX | uniswap-v4 | 0.25% | native | error | — | — | ❌ |
| NFLX | uniswap-v3 | 0.3% | WETH | error | — | — | ❌ |
| AMD | uniswap-v4 | 5% | native | 0.0034963444 | 0.02% | 10.24% | ❌ |
| AMD | uniswap-v4 | 1.5% | native | error | — | — | ❌ |
| AMD | uniswap-v4 | 80% | native | 0.00047349643 | 20.01% | 96.94% | ❌ |
| AMD | uniswap-v4 | 85% | native | error | — | — | ❌ |
| AMD | uniswap-v4 | 99.8% | native | error | — | — | ❌ |
| AMD | uniswap-v4 | 99.8447% | native | error | — | — | ❌ |
| AMD | uniswap-v4 | 97.654% | native | error | — | — | ❌ |
| AMD | uniswap-v4 | 95% | native | 0.00029510469 | 15.31% | 99.79% | ❌ |
| AMD | uniswap-v4 | 5.095% | native | error | — | — | ❌ |
| AMD | uniswap-v4 | 1% | native | error | — | — | ❌ |
| AMD | uniswap-v4 | 80% | native | error | — | — | ❌ |
| AMD | uniswap-v4 | 0.4321% | native | error | — | — | ❌ |
| AMD | uniswap-v4 | 0.4322% | native | error | — | — | ❌ |
| AMD | uniswap-v4 | 0.25% | native | 0.0032024813 | 16.49% | 29.14% | ❌ |
| AMD | uniswap-v4 | 92.009% | native | error | — | — | ❌ |
| AMD | uniswap-v4 | 4.96% | native | error | — | — | ❌ |
| AMD | uniswap-v4 | 70% | native | 0.0012149046 | 0.54% | 91.10% | ❌ |
| AMD | uniswap-v4 | 4.8% | native | error | — | — | ❌ |
| AMD | uniswap-v4 | 1% | native | 0.0031422114 | 17.15% | 31.16% | ❌ |
| AMD | uniswap-v4 (hook 0x3c0C…) | dynamic | weth | — | — | — | ❌ |
| AMD | uniswap-v3 | 0.3% | WETH | 0.003861577 | 0.00% | 0.90% | ✅ |
| MSFT | uniswap-v4 | 5% | native | error | — | — | ❌ |
| MSFT | uniswap-v4 | 1% | native | 0.0033802173 | 0.00% | 2.49% | ✅ |
| MSFT | uniswap-v4 | 85% | native | error | — | — | ❌ |
| MSFT | uniswap-v4 | 97.654% | native | error | — | — | ❌ |
| MSFT | uniswap-v4 | 99.9068% | native | error | — | — | ❌ |
| MSFT | uniswap-v4 | 95% | native | 0.00041977402 | 15.67% | 99.79% | ❌ |
| MSFT | uniswap-v4 | 5.095% | native | error | — | — | ❌ |
| MSFT | uniswap-v4 | 0.3% | native | error | — | — | ❌ |
| MSFT | uniswap-v4 (hook 0xf869…) | dynamic | native | — | — | — | ❌ |
| MSFT | uniswap-v4 | 80% | native | error | — | — | ❌ |
| MSFT | uniswap-v4 (hook 0xe979…) | dynamic | native | — | — | — | ❌ |
| MSFT | uniswap-v4 | 0.25% | native | error | — | — | ❌ |
| MSFT | uniswap-v4 | 0.19% | native | error | — | — | ❌ |
| MSFT | uniswap-v4 | 0.18% | native | error | — | — | ❌ |
| MSFT | uniswap-v3 | 0.3% | WETH | error | — | — | ❌ |
| GOOGL | uniswap-v4 | 8% | native | error | — | — | ❌ |
| GOOGL | uniswap-v4 | 0.01% | native | 0.000001229035 | 98.98% | 99.99% | ❌ |
| GOOGL | uniswap-v4 | 1% | native | 0.0061235412 | 0.01% | 2.50% | ✅ |
| GOOGL | uniswap-v4 | 5% | native | 0.0057664618 | 0.00% | 10.21% | ❌ |
| GOOGL | uniswap-v4 | 0.95% | native | error | — | — | ❌ |
| GOOGL | uniswap-v4 | 85% | native | error | — | — | ❌ |
| GOOGL | uniswap-v4 | 99.8834% | native | error | — | — | ❌ |
| GOOGL | uniswap-v4 | 99.9798% | native | error | — | — | ❌ |
| GOOGL | uniswap-v4 | 95% | native | 0.00050479495 | 15.49% | 99.79% | ❌ |
| GOOGL | uniswap-v4 | 5.095% | native | error | — | — | ❌ |
| GOOGL | uniswap-v4 | 80% | native | error | — | — | ❌ |
| GOOGL | uniswap-v4 | 0.25% | native | error | — | — | ❌ |
| GOOGL | uniswap-v4 | 4.9999% | native | error | — | — | ❌ |
| GOOGL | uniswap-v4 | 0.1% | native | 0.0058949195 | 5.08% | 7.67% | ❌ |
| GOOGL | uniswap-v4 | 10% | native | error | — | — | ❌ |
| GOOGL | uniswap-v4 (hook 0x2618…) | 0% | native | — | — | — | ❌ |
| GOOGL | uniswap-v4 | 0.21% | native | 0.0062180185 | 0.00% | 0.79% | ✅ |
| GOOGL | uniswap-v4 | 5% | native | error | — | — | ❌ |
| GOOGL | uniswap-v4 | 5.0001% | native | error | — | — | ❌ |
| GOOGL | uniswap-v4 | 5.0002% | native | error | — | — | ❌ |
| GOOGL | uniswap-v4 | 5.0003% | native | error | — | — | ❌ |
| GOOGL | uniswap-v4 | 5.0004% | native | error | — | — | ❌ |
| GOOGL | uniswap-v4 (hook 0xF4F6…) | 5% | weth | — | — | — | ❌ |
| GOOGL | uniswap-v4 (hook 0x4913…) | dynamic | weth | — | — | — | ❌ |
| GOOGL | uniswap-v3 | 0.01% | WETH | 0.0062172973 | 0.76% | 1.83% | ✅ |
| GOOGL | uniswap-v3 | 0.05% | WETH | error | — | — | ❌ |
| GOOGL | uniswap-v3 | 0.3% | WETH | error | — | — | ❌ |
| GOOGL | uniswap-v3 | 1% | WETH | 0.0061754256 | 0.00% | 2.29% | ✅ |
| META | uniswap-v4 | 10% | native | error | — | — | ❌ |
| META | uniswap-v4 | 5% | native | 0.0027325719 | 0.01% | 10.22% | ❌ |
| META | uniswap-v4 | 1% | native | error | — | — | ❌ |
| META | uniswap-v4 | 85% | native | error | — | — | ❌ |
| META | uniswap-v4 | 99.8% | native | error | — | — | ❌ |
| META | uniswap-v4 | 97.654% | native | error | — | — | ❌ |
| META | uniswap-v4 | 99.9417% | native | error | — | — | ❌ |
| META | uniswap-v4 | 95% | native | 0.00025409954 | 14.93% | 99.79% | ❌ |
| META | uniswap-v4 | 5.095% | native | error | — | — | ❌ |
| META | uniswap-v4 | 0.9% | native | 0.0029408347 | 0.03% | 2.34% | ✅ |
| META | uniswap-v4 | 89.009% | native | error | — | — | ❌ |
| META | uniswap-v4 (hook 0xEf11…) | dynamic | native | — | — | — | ❌ |
| META | uniswap-v4 | 80% | native | error | — | — | ❌ |
| META | uniswap-v4 | 4.99% | native | error | — | — | ❌ |
| META | uniswap-v4 | 70% | native | 0.0012119019 | 0.73% | 91.13% | ❌ |
| META | uniswap-v4 | 4.8% | native | 0.0027453588 | 0.40% | 10.53% | ❌ |
| META | uniswap-v4 | 62.4224% | native | 0.00083205234 | 42.80% | 93.13% | ❌ |
| META | uniswap-v4 (hook 0xe979…) | dynamic | native | — | — | — | ❌ |
| META | uniswap-v4 | 0.1% | native | error | — | — | ❌ |
| META | uniswap-v4 | 0.19% | native | error | — | — | ❌ |
| META | uniswap-v4 | 0.21% | native | 0.0029481164 | 0.00% | 0.79% | ✅ |
| META | uniswap-v4 | 98.99% | native | 0.000036431703 | 2.79% | 99.99% | ❌ |
| META | uniswap-v4 | 33.8333% | native | 0.00084613524 | 64.91% | 89.53% | ❌ |
| META | uniswap-v4 | 97.99% | native | 0.00006495601 | 0.51% | 99.96% | ❌ |
| META | uniswap-v4 | 0.2099% | native | error | — | — | ❌ |
| META | uniswap-v4 (hook 0xc60B…) | dynamic | weth | — | — | — | ❌ |
| META | uniswap-v3 | 0.3% | WETH | 0.0029476807 | 0.00% | 0.89% | ✅ |
| META | uniswap-v3 | 1% | WETH | error | — | — | ❌ |
| SPY | uniswap-v4 | 1% | native | 0.0021895717 | 7.65% | 15.32% | ❌ |
| SPY | uniswap-v4 | 5% | native | 0.0022184872 | 0.21% | 10.57% | ❌ |
| SPY | uniswap-v4 | 66% | native | 0.0013759552 | 18.66% | 91.22% | ❌ |
| SPY | uniswap-v4 | 85% | native | error | — | — | ❌ |
| SPY | uniswap-v4 | 0.95% | native | error | — | — | ❌ |
| SPY | uniswap-v4 | 99.798% | native | 0.00067788562 | 17.62% | 99.99% | ❌ |
| SPY | uniswap-v4 | 99.8% | native | error | — | — | ❌ |
| SPY | uniswap-v4 | 97.654% | native | error | — | — | ❌ |
| SPY | uniswap-v4 | 95% | native | 0.00021536154 | 15.17% | 99.79% | ❌ |
| SPY | uniswap-v4 | 0.3% | native | error | — | — | ❌ |
| SPY | uniswap-v4 | 98.65% | native | 0.00027080472 | 7.32% | 99.98% | ❌ |
| SPY | uniswap-v4 (hook 0xb284…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0xe37A…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 | 80% | native | error | — | — | ❌ |
| SPY | uniswap-v4 | 97.5025% | native | error | — | — | ❌ |
| SPY | uniswap-v4 | 99% | native | error | — | — | ❌ |
| SPY | uniswap-v4 | 0.1% | native | 0.0024098939 | 0.00% | 0.53% | ✅ |
| SPY | uniswap-v4 (hook 0xEf11…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 | 96.9% | native | error | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 | 4.83% | native | error | — | — | ❌ |
| SPY | uniswap-v4 | 0.9% | native | error | — | — | ❌ |
| SPY | uniswap-v4 | 0.0375% | native | error | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x344A…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 | 70% | native | 0.00090689759 | 0.57% | 91.11% | ❌ |
| SPY | uniswap-v4 (hook 0x104a…) | 0% | native | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x87bd…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x87bd…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x87bd…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x3c0C…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x0Aa5…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 | 2.1% | native | error | — | — | ❌ |
| SPY | uniswap-v4 | 50% | native | error | — | — | ❌ |
| SPY | uniswap-v4 | 99.5% | native | error | — | — | ❌ |
| SPY | uniswap-v4 (hook 0xAf23…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 | 0.035% | native | error | — | — | ❌ |
| SPY | uniswap-v4 | 0.25% | native | error | — | — | ❌ |
| SPY | uniswap-v4 (hook 0xcA89…) | dynamic | native | — | — | — | ❌ |
| SPY | uniswap-v4 | 10% | native | error | — | — | ❌ |
| SPY | uniswap-v4 | 0.0999% | native | error | — | — | ❌ |
| SPY | uniswap-v4 | 2% | native | 0.0023202856 | 0.24% | 4.91% | ✅ |
| SPY | uniswap-v4 (hook 0x57A6…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0xDA9D…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x1bf8…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0xb112…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x8DC6…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x8DC6…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x0723…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0xd5b0…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x2e78…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x84B9…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x84B9…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0xbD8a…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0xbD8a…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x3c0C…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x3c0C…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x171f…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x9a8A…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x48B8…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0xc60B…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0xe449…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0xe449…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 | 0.04% | weth | error | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x05cb…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0xB932…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0x9585…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0xA117…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v4 (hook 0xA13F…) | dynamic | weth | — | — | — | ❌ |
| SPY | uniswap-v3 | 0.01% | WETH | error | — | — | ❌ |
| SPY | uniswap-v3 | 0.05% | WETH | 0.0024129932 | 0.00% | 0.39% | ✅ |
| SPY | uniswap-v3 | 0.3% | WETH | error | — | — | ❌ |
| QQQ | uniswap-v4 | 1% | native | 0.0026665345 | 0.02% | 2.53% | ✅ |
| QQQ | uniswap-v4 | 85% | native | error | — | — | ❌ |
| QQQ | uniswap-v4 | 5% | native | error | — | — | ❌ |
| QQQ | uniswap-v4 | 5% | native | 0.0024886011 | 0.02% | 10.24% | ❌ |
| QQQ | uniswap-v4 | 95% | native | 0.00030413619 | 23.53% | 99.81% | ❌ |
| QQQ | uniswap-v4 | 99% | native | error | — | — | ❌ |
| QQQ | uniswap-v4 | 0.25% | native | error | — | — | ❌ |
| QQQ | uniswap-v4 | 0.1% | native | error | — | — | ❌ |
| QQQ | uniswap-v4 (hook 0xEf11…) | dynamic | native | — | — | — | ❌ |
| QQQ | uniswap-v4 | 80% | native | error | — | — | ❌ |
| QQQ | uniswap-v4 | 10% | native | error | — | — | ❌ |
| QQQ | uniswap-v4 | 0.9% | native | error | — | — | ❌ |
| QQQ | uniswap-v4 (hook 0xC7c0…) | dynamic | native | — | — | — | ❌ |
| QQQ | uniswap-v4 | 4.86% | native | error | — | — | ❌ |
| QQQ | uniswap-v4 | 70% | native | 0.0010326691 | 0.41% | 91.09% | ❌ |
| QQQ | uniswap-v4 | 3.6% | native | error | — | — | ❌ |
| QQQ | uniswap-v4 | 3% | native | error | — | — | ❌ |
| QQQ | uniswap-v4 (hook 0x0Aa5…) | dynamic | native | — | — | — | ❌ |
| QQQ | uniswap-v4 (hook 0xAf23…) | dynamic | native | — | — | — | ❌ |
| QQQ | uniswap-v4 | 94.99% | native | error | — | — | ❌ |
| QQQ | uniswap-v4 | 0.9999% | native | error | — | — | ❌ |
| QQQ | uniswap-v4 (hook 0xeD51…) | dynamic | weth | — | — | — | ❌ |
| QQQ | uniswap-v4 (hook 0x6ecE…) | dynamic | weth | — | — | — | ❌ |
| QQQ | uniswap-v4 (hook 0x2a48…) | dynamic | weth | — | — | — | ❌ |
| QQQ | uniswap-v4 (hook 0xDB48…) | dynamic | weth | — | — | — | ❌ |
| QQQ | uniswap-v4 (hook 0xac3C…) | dynamic | weth | — | — | — | ❌ |
| QQQ | uniswap-v4 (hook 0x6F54…) | dynamic | weth | — | — | — | ❌ |
| QQQ | uniswap-v4 (hook 0x9252…) | dynamic | weth | — | — | — | ❌ |
| QQQ | uniswap-v4 (hook 0x2A52…) | dynamic | weth | — | — | — | ❌ |
| QQQ | uniswap-v4 (hook 0x5ef3…) | dynamic | weth | — | — | — | ❌ |
| QQQ | uniswap-v3 | 0.05% | WETH | error | — | — | ❌ |
| QQQ | uniswap-v3 | 0.3% | WETH | 0.0027163729 | 0.03% | 0.92% | ✅ |
| QQQ | uniswap-v3 | 1% | WETH | error | — | — | ❌ |
| COIN | uniswap-v4 | 1% | native | 0.0000029952647 | 98.97% | 99.98% | ❌ |
| COIN | uniswap-v4 | 85% | native | error | — | — | ❌ |
| COIN | uniswap-v4 | 5% | native | 0.01491023 | 0.03% | 10.26% | ❌ |
| COIN | uniswap-v4 | 80% | native | 0.0022633408 | 0.09% | 96.02% | ❌ |
| COIN | uniswap-v4 | 99.8834% | native | error | — | — | ❌ |
| COIN | uniswap-v4 | 97.654% | native | error | — | — | ❌ |
| COIN | uniswap-v4 | 95% | native | 0.0010088363 | 15.56% | 99.79% | ❌ |
| COIN | uniswap-v4 | 2.5% | native | error | — | — | ❌ |
| COIN | uniswap-v4 | 94.65% | native | 0.00018365589 | 4.73% | 99.72% | ❌ |
| COIN | uniswap-v4 | 65% | native | 0.0042374763 | 23.70% | 91.44% | ❌ |
| COIN | uniswap-v4 | 97.5001% | native | error | — | — | ❌ |
| COIN | uniswap-v4 | 80% | native | error | — | — | ❌ |
| COIN | uniswap-v4 | 2.55% | native | error | — | — | ❌ |
| COIN | uniswap-v4 | 4.5% | native | error | — | — | ❌ |
| COIN | uniswap-v4 | 4.88% | native | error | — | — | ❌ |
| COIN | uniswap-v4 | 70% | native | 0.0039187946 | 0.23% | 91.07% | ❌ |
| COIN | uniswap-v4 | 4.8% | native | error | — | — | ❌ |
| COIN | uniswap-v4 | 4% | native | error | — | — | ❌ |
| COIN | uniswap-v4 | 0.25% | native | error | — | — | ❌ |
| COIN | uniswap-v4 | 0.05% | native | error | — | — | ❌ |
| COIN | uniswap-v4 | 60% | native | error | — | — | ❌ |
| COIN | uniswap-v4 | 99.909% | native | 0.000012631231 | 0.41% | 99.99% | ❌ |
| COIN | uniswap-v4 (hook 0xe979…) | dynamic | native | — | — | — | ❌ |
| COIN | uniswap-v4 (hook 0xF4F6…) | 5% | weth | — | — | — | ❌ |
| COIN | uniswap-v4 (hook 0x35b5…) | dynamic | weth | — | — | — | ❌ |
| COIN | uniswap-v4 (hook 0x57A6…) | dynamic | weth | — | — | — | ❌ |
| COIN | uniswap-v4 (hook 0xEb4f…) | dynamic | weth | — | — | — | ❌ |
| COIN | uniswap-v3 | 0.05% | WETH | error | — | — | ❌ |
| COIN | uniswap-v3 | 0.3% | WETH | 0.016107298 | 0.00% | 0.89% | ✅ |
| COIN | uniswap-v3 | 1% | WETH | error | — | — | ❌ |

## Recording verdict

| Token | Usable v4 | Usable v3 | Route comparison possible | Recordable |
|---|---:|---:|---|---|
| NVDA | 4 | 2 | ✅ | ✅ |
| AAPL | 0 | 1 | ❌ | ✅ |
| TSLA | 1 | 1 | ✅ | ✅ |
| AMZN | 1 | 0 | ❌ | ✅ |
| SPCX | 2 | 1 | ✅ | ✅ |
| PLTR | 0 | 1 | ❌ | ✅ |
| NFLX | 0 | 0 | ❌ | ❌ do not record |
| AMD | 0 | 1 | ❌ | ✅ |
| MSFT | 1 | 0 | ❌ | ✅ |
| GOOGL | 2 | 2 | ✅ | ✅ |
| META | 2 | 1 | ✅ | ✅ |
| SPY | 2 | 1 | ✅ | ✅ |
| QQQ | 1 | 1 | ✅ | ✅ |
| COIN | 0 | 1 | ❌ | ✅ |

