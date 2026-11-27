# Perm · Mainnet proof (Robinhood Chain 4663)

Generated 2026-11-23T15:21:54Z by `node scripts/mainnet/proof-receipt.cjs` (read-only, straight from the chain via https://rpc.mainnet.chain.robinhood.com).
Explorer: https://robinhoodchain.blockscout.com · deployment commit `84295e7` · deployment block 121246040.

Mode: allowlisted mainnet showcase (non-release). Stock tokens are Robinhood Chain tokens, not shares. All amounts are real; demo trades use small amounts.

## Contracts (source verified on Blockscout + Sourcify, exact match)

| Contract | Address | Runtime codehash |
|---|---|---|
| PermRouter v2 | [`0x155bc06240dE046112e86C63a35f8b954AF32Ea2`](https://robinhoodchain.blockscout.com/address/0x155bc06240dE046112e86C63a35f8b954AF32Ea2) | `0x01f1a8f4781311e7331fa9d70b7f03f390da30411b5ade105635f8d2f4ba5cdf` |
| PermV4Adapter (Uniswap v4 direct, no hook) | [`0xee94ED044B7F1ec935A62109e172BCEf42A62E1A`](https://robinhoodchain.blockscout.com/address/0xee94ED044B7F1ec935A62109e172BCEf42A62E1A) | `0x9be1b5722f9a472267c5751971c8463f95f429b52ec47bc4975581aad78ebd1a` |
| PermV3Adapter (Uniswap v3 SwapRouter02) | [`0x8925caAD31C3a1ef66E41B7988a1d2b43Bb382E9`](https://robinhoodchain.blockscout.com/address/0x8925caAD31C3a1ef66E41B7988a1d2b43Bb382E9) | `0x5901832cbc981e4583e3006966a84d8fb0af4ef38ab3e5c15336471a41c0615f` |

## Roles and fee policy

| Role | Address |
|---|---|
| Owner / pause guardian | [`0x1FBaDaFb2056Af662aa11732e86B28aF550af0d9`](https://robinhoodchain.blockscout.com/address/0x1FBaDaFb2056Af662aa11732e86B28aF550af0d9) |
| Treasury | [`0x3d2faC269954487a63f51bF059701fbD9647e3Bf`](https://robinhoodchain.blockscout.com/address/0x3d2faC269954487a63f51bF059701fbD9647e3Bf) |
| Quote signer (EIP-712, remote, holds no funds) | [`0x183ef39A2eeEb812661a55a22b67b3917929f369`](https://robinhoodchain.blockscout.com/address/0x183ef39A2eeEb812661a55a22b67b3917929f369) |
| Referrer (50% of net fee) | [`0x8b43ac0F705D18d2C42D12Eb2FABe3e45e1045b1`](https://robinhoodchain.blockscout.com/address/0x8b43ac0F705D18d2C42D12Eb2FABe3e45e1045b1) |

Fee policy v1: **20 bps gross (0.20%)**, **25% fee rebate**, net 15 bps. Read on-chain from `PermRouter.feePolicies(1)`; published in the router deploy tx [`0xea5fea8c…9318f46c`](https://robinhoodchain.blockscout.com/tx/0xea5fea8c1f4134d9fd5597b855c4890b1ed012f9d93bc7732bebf9549318f46c).

Dependencies: Uniswap v4 PoolManager [`0x8366a39CC670B4001A1121B8F6A443A643e40951`](https://robinhoodchain.blockscout.com/address/0x8366a39CC670B4001A1121B8F6A443A643e40951) · Uniswap v3 SwapRouter02 [`0xCaf681a66D020601342297493863E78C959E5cb2`](https://robinhoodchain.blockscout.com/address/0xCaf681a66D020601342297493863E78C959E5cb2) · Permit2 [`0x000000000022D473030F116dDEE9F6B43aC78BA3`](https://robinhoodchain.blockscout.com/address/0x000000000022D473030F116dDEE9F6B43aC78BA3) · WETH [`0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`](https://robinhoodchain.blockscout.com/address/0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73).

## Deployment transactions

| Step | Tx | Gas used |
|---|---|---|
| deploy PermRouter (publishes fee policy v1 20 bps / 25% rebate) | [`0xea5fea8c…9318f46c`](https://robinhoodchain.blockscout.com/tx/0xea5fea8c1f4134d9fd5597b855c4890b1ed012f9d93bc7732bebf9549318f46c) | 3081484 |
| deploy PermV4Adapter | [`0xedddc3de…a5b5269e`](https://robinhoodchain.blockscout.com/tx/0xedddc3dedbc00948c9d67b11ecc3f64433c9f0f55f1f29ac5a3898eea5b5269e) | 1187015 |
| deploy PermV3Adapter (Uniswap V3 SwapRouter02) | [`0x08b20186…64b7fd41`](https://robinhoodchain.blockscout.com/tx/0x08b201869388824206ab743c6ce8cd7bb58d1f23ee049b1637d5390f64b7fd41) | 1031140 |
| configureAdapter(v4, UNISWAP_V4_DIRECT) | [`0x83382027…5e1af540`](https://robinhoodchain.blockscout.com/tx/0x833820277ed4b0cc38330024de108619040f965479e9452fc728c7545e1af540) | 96776 |
| configureAdapter(v3, UNISWAP_V3) | [`0x05876843…0926f72c`](https://robinhoodchain.blockscout.com/tx/0x058768436f43d369bc4b539652683d989fff1a82e69f58499b72c1a20926f72c) | 96776 |
| configureReferral(5000 bps) | [`0xb479ede2…f3f0f66e`](https://robinhoodchain.blockscout.com/tx/0xb479ede219840b122c8d7af0606e4719b55695045c1997f731f68cfff3f0f66e) | 47900 |

## Feature proofs

| Feature | Tx | Block · time (UTC) | Result | Status |
|---|---|---|---|---|
| Smoke test · ETH → NVDA (Uniswap v4) | [`0x2c4d412e…3fc7d99c`](https://robinhoodchain.blockscout.com/tx/0x2c4d412e1d6dd8fa90b4d4476337e4ee2f51bd4e4388d17a27f8fc863fc7d99c) | 121287077 · 2026-11-23T08:54:35Z | 0.0005 ETH → 0.006333552858193761 NVDA · 1 step(s): uniswapV4Direct | Success |
| Klip 05 · Swap Uniswap v4 · ETH → NVDA | [`0xa7f8c185…8f0f1f9f`](https://robinhoodchain.blockscout.com/tx/0xa7f8c185663cdf2ad2eae85a916eca6f1727b6213e2a0ca39193fea88f0f1f9f) | 121323843 · 2026-11-23T09:59:43Z | 0.0005 ETH → 0.006295118343962362 NVDA · 1 step(s): uniswapV4Direct | Success |
| Klip 06 · one-time NVDA approval to Permit2 | [`0x17b9b470…a26e2554`](https://robinhoodchain.blockscout.com/tx/0x17b9b470a83610d99fe723dda994b708d0d8c7d8ad495fc15b1eb328a26e2554) | 121479887 · 2026-11-23T14:32:48Z | one-time exact approval of 0.01 NVDA to Permit2 | Success |
| Klip 06 · Multi-hop cross-venue · NVDA → ETH → AAPL | [`0x1a645ad8…94fb8d03`](https://robinhoodchain.blockscout.com/tx/0x1a645ad8b7da93657f219653f0005fc107431ef387bf9e5e2d886c6094fb8d03) | 121481904 · 2026-11-23T14:36:07Z | 0.005 NVDA → 0.002280771735309248 AAPL · 2 step(s): uniswapV4Direct → uniswapV3 · Permit2 | Success |
| Klip 07 · one-time AAPL approval to Permit2 | [`0x433d03ce…2c462d6f`](https://robinhoodchain.blockscout.com/tx/0x433d03ce5945f0add0aa13012d658ea3a5020dcf7d6da9a5262925132c462d6f) | 121485194 · 2026-11-23T14:41:35Z | one-time exact approval of 0.002 AAPL to Permit2 | Success |
| Klip 07 · Permit2 signature swap · AAPL → ETH | [`0xb2eda1e7…296c3619`](https://robinhoodchain.blockscout.com/tx/0xb2eda1e74b3e41b8885198b2b39b3a05312e6c85c7fcb6b817fc6c9a296c3619) | 121485780 · 2026-11-23T14:42:34Z | 0.002 AAPL → 0.00038487322682107 ETH · 1 step(s): uniswapV3 · Permit2 | Success |
| Klip 08 · Referral swap · ETH → NVDA | [`0x60b80e89…1f9a6da9`](https://robinhoodchain.blockscout.com/tx/0x60b80e89785495959282cae6666718e96431ea06fa09bfe846e530d41f9a6da9) | 121495394 · 2026-11-23T14:58:33Z | 0.0005 ETH → 0.005306950075014674 NVDA · 1 step(s): uniswapV4Direct · referral | Success |
| Klip 08 · Referrer claims its fee share | [`0x3075c65d…cbb9e007`](https://robinhoodchain.blockscout.com/tx/0x3075c65d2d6b1b56f08cbe6df5f1bb980b64c83c769234937d3042b0cbb9e007) | 121498384 · 2026-11-23T15:03:29Z | fee claim 0.000000375 ETH by referrer | Success |

## Decoded receipts

### Smoke test · ETH → NVDA (Uniswap v4)

- Tx: https://robinhoodchain.blockscout.com/tx/0x2c4d412e1d6dd8fa90b4d4476337e4ee2f51bd4e4388d17a27f8fc863fc7d99c
- Status **Success** · block 121287077 · 2026-11-23T08:54:35Z · from 0x141DB8c1C42B0fa5b13eE17136e4E037597886a8 · to 0x155bc06240dE046112e86C63a35f8b954AF32Ea2 · gas 315136 · network fee 0.000006307131904 ETH

```
FeeAccrued · 0.00000075 ETH reserved for treasury 0x3d2faC269954487a63f51bF059701fbD9647e3Bf
RouteStepSettled #0 · uniswapV4Direct · adapter PermV4Adapter (Uniswap v4 direct) 0xee94ED044B7F1ec935A62109e172BCEf42A62E1A · 0.00049925 ETH → 0.006333552858193761 NVDA · hook none
SwapSettled · account 0x141DB8c1C42B0fa5b13eE17136e4E037597886a8 · 0.0005 ETH → 0.006333552858193761 NVDA
  fee: gross 0.000001 ETH · fee rebate 0.00000025 ETH · net 0.00000075 ETH · referral 0.0 ETH · treasury 0.00000075 ETH · policy v1
call swapExactInput · token authorization: native ETH (no approval)
```

- ✅ gross fee = floor(amountIn × 20 / 10000)
- ✅ fee rebate = floor(gross × 2500 / 10000)
- ✅ net = gross − rebate = referral + treasury
- ✅ routed input = amountIn − net fee
- ✅ no hook in any route step

### Klip 05 · Swap Uniswap v4 · ETH → NVDA

- Tx: https://robinhoodchain.blockscout.com/tx/0xa7f8c185663cdf2ad2eae85a916eca6f1727b6213e2a0ca39193fea88f0f1f9f
- Status **Success** · block 121323843 · 2026-11-23T09:59:43Z · from 0x141DB8c1C42B0fa5b13eE17136e4E037597886a8 · to 0x155bc06240dE046112e86C63a35f8b954AF32Ea2 · gas 246716 · network fee 0.000004950109824 ETH

```
FeeAccrued · 0.00000075 ETH reserved for treasury 0x3d2faC269954487a63f51bF059701fbD9647e3Bf
RouteStepSettled #0 · uniswapV4Direct · adapter PermV4Adapter (Uniswap v4 direct) 0xee94ED044B7F1ec935A62109e172BCEf42A62E1A · 0.00049925 ETH → 0.006295118343962362 NVDA · hook none
SwapSettled · account 0x141DB8c1C42B0fa5b13eE17136e4E037597886a8 · 0.0005 ETH → 0.006295118343962362 NVDA
  fee: gross 0.000001 ETH · fee rebate 0.00000025 ETH · net 0.00000075 ETH · referral 0.0 ETH · treasury 0.00000075 ETH · policy v1
call swapExactInput · token authorization: native ETH (no approval)
```

- ✅ gross fee = floor(amountIn × 20 / 10000)
- ✅ fee rebate = floor(gross × 2500 / 10000)
- ✅ net = gross − rebate = referral + treasury
- ✅ routed input = amountIn − net fee
- ✅ no hook in any route step

### Klip 06 · one-time NVDA approval to Permit2

- Tx: https://robinhoodchain.blockscout.com/tx/0x17b9b470a83610d99fe723dda994b708d0d8c7d8ad495fc15b1eb328a26e2554
- Status **Success** · block 121479887 · 2026-11-23T14:32:48Z · from 0x141DB8c1C42B0fa5b13eE17136e4E037597886a8 · to 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC · gas 92839 · network fee 0.000002207154386 ETH

```
Approval · NVDA · owner 0x141DB8c1C42B0fa5b13eE17136e4E037597886a8 → spender Permit2 0x000000000022D473030F116dDEE9F6B43aC78BA3 · 0.01 NVDA
```

### Klip 06 · Multi-hop cross-venue · NVDA → ETH → AAPL

- Tx: https://robinhoodchain.blockscout.com/tx/0x1a645ad8b7da93657f219653f0005fc107431ef387bf9e5e2d886c6094fb8d03
- Status **Success** · block 121481904 · 2026-11-23T14:36:07Z · from 0x141DB8c1C42B0fa5b13eE17136e4E037597886a8 · to 0x155bc06240dE046112e86C63a35f8b954AF32Ea2 · gas 592621 · network fee 0.000027191821964 ETH

```
FeeAccrued · 0.0000075 NVDA reserved for treasury 0x3d2faC269954487a63f51bF059701fbD9647e3Bf
RouteStepSettled #0 · uniswapV4Direct · adapter PermV4Adapter (Uniswap v4 direct) 0xee94ED044B7F1ec935A62109e172BCEf42A62E1A · 0.0049925 NVDA → 0.000439234940784123 ETH · hook none
RouteStepSettled #1 · uniswapV3 · adapter PermV3Adapter (Uniswap v3) 0x8925caAD31C3a1ef66E41B7988a1d2b43Bb382E9 · 0.000439234940784123 ETH → 0.002280771735309248 AAPL · hook none
SwapSettled · account 0x141DB8c1C42B0fa5b13eE17136e4E037597886a8 · 0.005 NVDA → 0.002280771735309248 AAPL
  fee: gross 0.00001 NVDA · fee rebate 0.0000025 NVDA · net 0.0000075 NVDA · referral 0.0 NVDA · treasury 0.0000075 NVDA · policy v1
call swapExactInput · token authorization: Permit2 signature (offchain, one trade)
```

- ✅ gross fee = floor(amountIn × 20 / 10000)
- ✅ fee rebate = floor(gross × 2500 / 10000)
- ✅ net = gross − rebate = referral + treasury
- ✅ routed input = amountIn − net fee
- ✅ no hook in any route step

### Klip 07 · one-time AAPL approval to Permit2

- Tx: https://robinhoodchain.blockscout.com/tx/0x433d03ce5945f0add0aa13012d658ea3a5020dcf7d6da9a5262925132c462d6f
- Status **Success** · block 121485194 · 2026-11-23T14:41:35Z · from 0x141DB8c1C42B0fa5b13eE17136e4E037597886a8 · to 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 · gas 176088 · network fee 0.000004299364608 ETH

```
Approval · AAPL · owner 0x141DB8c1C42B0fa5b13eE17136e4E037597886a8 → spender Permit2 0x000000000022D473030F116dDEE9F6B43aC78BA3 · 0.002 AAPL
```

### Klip 07 · Permit2 signature swap · AAPL → ETH

- Tx: https://robinhoodchain.blockscout.com/tx/0xb2eda1e74b3e41b8885198b2b39b3a05312e6c85c7fcb6b817fc6c9a296c3619
- Status **Success** · block 121485780 · 2026-11-23T14:42:34Z · from 0x141DB8c1C42B0fa5b13eE17136e4E037597886a8 · to 0x155bc06240dE046112e86C63a35f8b954AF32Ea2 · gas 875057 · network fee 0.000019042990434 ETH

```
FeeAccrued · 0.000003 AAPL reserved for treasury 0x3d2faC269954487a63f51bF059701fbD9647e3Bf
RouteStepSettled #0 · uniswapV3 · adapter PermV3Adapter (Uniswap v3) 0x8925caAD31C3a1ef66E41B7988a1d2b43Bb382E9 · 0.001997 AAPL → 0.00038487322682107 ETH · hook none
SwapSettled · account 0x141DB8c1C42B0fa5b13eE17136e4E037597886a8 · 0.002 AAPL → 0.00038487322682107 ETH
  fee: gross 0.000004 AAPL · fee rebate 0.000001 AAPL · net 0.000003 AAPL · referral 0.0 AAPL · treasury 0.000003 AAPL · policy v1
call swapExactInput · token authorization: Permit2 signature (offchain, one trade)
```

- ✅ gross fee = floor(amountIn × 20 / 10000)
- ✅ fee rebate = floor(gross × 2500 / 10000)
- ✅ net = gross − rebate = referral + treasury
- ✅ routed input = amountIn − net fee
- ✅ no hook in any route step

### Klip 08 · Referral swap · ETH → NVDA

- Tx: https://robinhoodchain.blockscout.com/tx/0x60b80e89785495959282cae6666718e96431ea06fa09bfe846e530d41f9a6da9
- Status **Success** · block 121495394 · 2026-11-23T14:58:33Z · from 0x141DB8c1C42B0fa5b13eE17136e4E037597886a8 · to 0x155bc06240dE046112e86C63a35f8b954AF32Ea2 · gas 273876 · network fee 0.000005977069824 ETH

```
FeeAccrued · 0.000000375 ETH reserved for referrer 0x8b43ac0F705D18d2C42D12Eb2FABe3e45e1045b1
FeeAccrued · 0.000000375 ETH reserved for treasury 0x3d2faC269954487a63f51bF059701fbD9647e3Bf
RouteStepSettled #0 · uniswapV4Direct · adapter PermV4Adapter (Uniswap v4 direct) 0xee94ED044B7F1ec935A62109e172BCEf42A62E1A · 0.00049925 ETH → 0.005306950075014674 NVDA · hook none
SwapSettled · account 0x141DB8c1C42B0fa5b13eE17136e4E037597886a8 · 0.0005 ETH → 0.005306950075014674 NVDA
  fee: gross 0.000001 ETH · fee rebate 0.00000025 ETH · net 0.00000075 ETH · referral 0.000000375 ETH · treasury 0.000000375 ETH · policy v1
call swapExactInput · token authorization: native ETH (no approval)
  referrer signed into the quote: referrer 0x8b43ac0F705D18d2C42D12Eb2FABe3e45e1045b1
```

- ✅ gross fee = floor(amountIn × 20 / 10000)
- ✅ fee rebate = floor(gross × 2500 / 10000)
- ✅ net = gross − rebate = referral + treasury
- ✅ routed input = amountIn − net fee
- ✅ no hook in any route step

### Klip 08 · Referrer claims its fee share

- Tx: https://robinhoodchain.blockscout.com/tx/0x3075c65d2d6b1b56f08cbe6df5f1bb980b64c83c769234937d3042b0cbb9e007
- Status **Success** · block 121498384 · 2026-11-23T15:03:29Z · from 0x8b43ac0F705D18d2C42D12Eb2FABe3e45e1045b1 · to 0x155bc06240dE046112e86C63a35f8b954AF32Ea2 · gas 55391 · network fee 0.000001211511952 ETH

```
FeeClaimed · 0.000000375 ETH · beneficiary referrer 0x8b43ac0F705D18d2C42D12Eb2FABe3e45e1045b1 → recipient referrer 0x8b43ac0F705D18d2C42D12Eb2FABe3e45e1045b1
call claimFees
```

## Reproduce

```bash
node scripts/mainnet/proof-receipt.cjs 0x2c4d412e1d6dd8fa90b4d4476337e4ee2f51bd4e4388d17a27f8fc863fc7d99c 0xa7f8c185663cdf2ad2eae85a916eca6f1727b6213e2a0ca39193fea88f0f1f9f 0x17b9b470a83610d99fe723dda994b708d0d8c7d8ad495fc15b1eb328a26e2554 0x1a645ad8b7da93657f219653f0005fc107431ef387bf9e5e2d886c6094fb8d03 0x433d03ce5945f0add0aa13012d658ea3a5020dcf7d6da9a5262925132c462d6f 0xb2eda1e74b3e41b8885198b2b39b3a05312e6c85c7fcb6b817fc6c9a296c3619 0x60b80e89785495959282cae6666718e96431ea06fa09bfe846e530d41f9a6da9 0x3075c65d2d6b1b56f08cbe6df5f1bb980b64c83c769234937d3042b0cbb9e007
cast receipt <tx> --rpc-url https://rpc.mainnet.chain.robinhood.com   # optional, Foundry
```
