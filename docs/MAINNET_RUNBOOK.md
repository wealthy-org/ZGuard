# Perm — Runbook Mainnet (Robinhood Chain 4663)

Runbook ini mengubah Perm dari testnet (46630) ke **mainnet 4663** untuk rekaman showcase: deploy kontrak, remote quote signer, env Vercel, fee policy, allowlist, dan satu smoke swap jumlah terkecil sebelum take utama.

> **Aturan kunci.** Semua langkah yang butuh private key atau dana **dijalankan sendiri di mesin Anda**. Jangan pernah menempel private key ke chat, issue, PR, log CI, atau layar rekaman. Jangan tampilkan `/setup`, pengaturan quote signer, `.env`, atau private key di video.

| § | Langkah | Siapa | Butuh key/dana |
|---|---|---|---|
| 1 | Siapkan 4 alamat & budget | Anda | — |
| 2 | Deploy PermRouter + PermV4Adapter + PermV3Adapter (+ PermV2Adapter, PermWethAdapter, pin Aggregator Hook), verifikasi Blockscout, commit manifest | Anda | deployer key + ETH |
| 3 | Jalankan remote quote signer, daftarkan alamatnya | Anda | signer key (tanpa dana), owner key bila rotasi |
| 4 | Env Vercel web app (RPC, token list, mode mainnet) | Anda | — |
| 5 | Fee policy 0,20% gross / 25% fee rebate (sudah on-chain saat deploy) | otomatis + cek | — |
| 6 | Allowlist wallet rekaman + smoke swap terkecil → buka UI | Anda | recording wallet + ±0,003 ETH |
| 7 | Checklist sebelum take utama | Anda | — |

Yang **sudah diverifikasi di fork mainnet** (anvil fork 4663, bukan mainnet asli):
- Deploy kontrak → `verify-deployment.mjs` 0 gagal.
- Web app mode `allowlisted-mainnet` → remote signer HTTPS + bearer token → signature me-recover ke `PermRouter.quoteSigner()`.
- Fee sama dengan `previewFees` → swap 0,001 ETH → NVDA lewat pool Uniswap v4 → event `SwapSettled` (gross 0,000002 / rebate 0,0000005 / net 0,0000015 ETH, gas 315.304) → `/api/receipts` menampilkan receipt.
- `mainnet-admin.cjs` untuk `status`, `set-quote-signer`, `pause`, `unpause`, `configure-referral` (set + hapus), `set-treasury`, `transfer-ownership` → `accept-ownership` (Router + 3 adapter), `set-adapter`, `set-hook`, `set-hook-provider`, dan guard pemilik.
- `pnpm contracts:test:mainnet` (15 tes fork) termasuk:
  - Uniswap Aggregator Hook: ETH → WETH (1:1) → NVDA dan baliknya;
  - USDG hub: ETH → USDG → AMZN / NFLX / MSFT;
  - Uniswap V2: ETH → USDG → SPY;
  - rotasi treasury, ubah/hapus referral, dan serah-terima ownership dua langkah.

- `/api/quote` terhadap state mainnet asli (read-only, router di-mock) menghasilkan route yang benar:
  - AMZN, NFLX, MSFT → ETH → USDG → token (v3 0,01% lalu 0,30%);
  - SPY mode `v2` → dua pair Uniswap V2;
  - NVDA mode `hooks` → wrap → Aggregator Hook;
  - mode `v4` tidak pernah memilih hook;
  - pair V2 berisi debu dan kandidat yang >10% lebih buruk dari yang terbaik disembunyikan.

Belum terbukti: swap hook/USDG-hub/V2 lewat web app di anvil fork. Fork dingin dengan RPC publik terlalu lambat untuk quote ini; jalur on-chain-nya sudah lolos di `contracts:test:mainnet`. Setelah deploy asli, jalankan smoke dry-run (§6.2, tanpa `CONFIRM_MAINNET`) untuk tiap venue. Dry-run mensimulasikan tx di mainnet tanpa mengirim apa pun.

Ulangi kapan saja dengan `pnpm mainnet:fork-e2e`.

---

## 1 · Prasyarat

### 1.1 Empat alamat terpisah

| Peran | Fungsi | Dana |
|---|---|---|
| **Deployer / owner** | Deploy kontrak dan menjadi `owner()`. Menjalankan `setQuoteSigner`, `pause`/`unpause`. | ±0,001 ETH (estimasi deploy lengkap 7,68 jt gas ≈ 0,000154 ETH @ 0,02 gwei; ×3 buffer ≈ 0,00046 ETH) |
| **Treasury** | Penerima fee bersih. Klaim fee dengan key **treasury** (`claimFees` dikirim oleh beneficiary sendiri). | 0 (sedikit untuk gas klaim) |
| **Quote signer** | Key khusus yang **hanya** menandatangani quote EIP-712. Tidak pernah memegang dana, tidak sama dengan owner. | **0** |
| **Recording wallet** | Wallet yang tampil di video. Masuk allowlist. | ±0,003 ETH (smoke 0,001 + take + gas) |

Untuk produksi jangka panjang, pindahkan owner ke multisig/timelock setelah setup (`ACTION=transfer-ownership`, lihat §9).

### 1.2 Repo bersih dan dependensi

```bash
git checkout -b mainnet-4663
git add -A && git commit -m "feat: Perm mainnet 4663 mode"   # broadcast deploy menolak working tree kotor
corepack pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm server:test             # tsc, eslint, 6 tes server + mainnet-mode + signer
```

### 1.3 Cek likuiditas (opsional, read-only)

```bash
pnpm mainnet:liquidity -- --tokens NVDA,AAPL,TSLA,SPCX,GOOGL,META,SPY --amount 0.001
pnpm mainnet:pools                                           # regenerasi deployments/mainnet/v4-pools.json
```

Hasil audit (blok 121089419) ada di `deployments/mainnet/liquidity-report.md`.

Venue tambahan (semua read-only, tanpa key):

```bash
node scripts/mainnet/check-hub-routes.mjs           # ±2,5 menit → deployments/mainnet/hub-routes.{json,md}
node scripts/mainnet/discover-aggregator-hooks.mjs  # ±3 menit   → deployments/mainnet/aggregator-hooks.json
```

| Venue / token | Status di 4663 | Cara Perm memakainya |
|---|---|---|
| **AMZN, NFLX, MSFT** | Pool ETH langsung tipis (round trip 104 / 1022 / 249 bps), **tapi** pool Uniswap v3 0,30% terhadap **USDG** dalam (round trip lewat USDG 63 / 61 / 61 bps). | Route 2 langkah ETH → USDG (v3 0,01%) → token (v3 0,30%). USDG hanya hub, tidak muncul di picker. Wajib mode `best` atau `v3`. |
| **Uniswap Aggregator Hook** | Resmi live di 4663 sejak Oktober 2026 (Uniswap Labs, sumber Slipstream). Uniswap tidak menerbitkan daftar alamat, jadi Perm menemukan hook on-chain dan **mem-pin codehash**-nya. | 2 hook `SlipstreamAggregator v1.0` (8 pool sisi WETH: NVDA, AAPL, SPCX, SPY, USDG). Route ETH → WETH (`PermWethAdapter`, 1:1) → pool hook → token. Routed swap membayar **protocol fee Uniswap (default 10 bps)** di dalam harga quote. |
| **Uniswap V2** | Factory resmi Uniswap ada, tetapi hampir semua pair saham vs WETH berisi debu. Yang berguna hanya WETH/USDG (94 WETH / 162 rb USDG) dan SPY/USDG. | `PermV2Adapter` ke factory resmi (codehash pair di-pin). Jarang menang; berguna sebagai kandidat pembanding. |
| **Synthra** | **Tidak ada di 4663** (tidak ada di deployment resmi maupun on-chain). Tidak bisa dibuat "jalan". | Digantikan Uniswap v3 (SwapRouter02) sebagai venue v3. |

---

## 2 · Deploy kontrak

### 2.1 Estimasi dan rehearsal (tanpa key)

```bash
ESTIMATE_ONLY=1 DEPLOYER_ADDRESS=0xDEPLOYER QUOTE_SIGNER_ADDRESS=0xSIGNER TREASURY_ADDRESS=0xTREASURY \
  pnpm contracts:estimate:mainnet

QUOTE_SIGNER_ADDRESS=0xSIGNER TREASURY_ADDRESS=0xTREASURY pnpm contracts:rehearse:mainnet
pnpm contracts:test:mainnet                                  # 15 tes fork (Klip 02, 05–09 + hook, USDG hub, V2, admin), ±5 menit
```

`QUOTE_SIGNER_ADDRESS` diambil dari §3.1. Buat key signer **sebelum** deploy, supaya alamatnya langsung tertanam dan `setQuoteSigner` tidak perlu dijalankan lagi.

### 2.2 Broadcast (ETH sungguhan)

```bash
export MAINNET_DEPLOYER_PRIVATE_KEY=0x…        # hanya di shell lokal Anda; jangan simpan di repo
CONFIRM_MAINNET=1 VERIFY=1 \
QUOTE_SIGNER_ADDRESS=0xSIGNER TREASURY_ADDRESS=0xTREASURY \
  pnpm contracts:deploy:mainnet
unset MAINNET_DEPLOYER_PRIVATE_KEY
```

Skrip ini melakukan:
- deploy `PermRouter`, sekaligus mempublikasikan **fee policy v1 = 20 bps gross, 25% rebate**;
- deploy `PermV4Adapter` (PoolManager v4) dan `PermV3Adapter` (Uniswap V3 SwapRouter02, karena Synthra tidak ada di 4663);
- deploy `PermV2Adapter` (factory Uniswap V2 resmi), kecuali `DEPLOY_V2=0`;
- deploy `PermWethAdapter` (wrap/unwrap 1:1 untuk pool hook sisi WETH), `setVerifiedHook` untuk tiap hook di `deployments/mainnet/aggregator-hooks.json` (codehash, permission bits 0x2888, PoolManager, dan versi dicek ulang sebelum tx), lalu `configureHookProvider`. Lewati dengan `ENABLE_AGGREGATOR_HOOKS=0`;
- `configureAdapter` untuk semua adapter;
- verifikasi source di Blockscout (`VERIFY=1`);
- menulis `deployments/robinhood-mainnet.json`.

Guard: skrip menolak menimpa manifest yang sudah berisi alamat, kecuali dengan `FORCE_REDEPLOY=1`.

Bila verifikasi Blockscout gagal (timeout/indexing), ulangi per kontrak:

```bash
npx hardhat verify --network robinhoodMainnet <alamat> <argumen constructor…>
```

Argumen constructor tercetak di output deploy dan di manifest.

### 2.3 Cek dan commit manifest

```bash
pnpm mainnet:verify                                           # read-only, exit 1 bila ada yang gagal
git add deployments/robinhood-mainnet.json && git commit -m "chore: publish Perm mainnet 4663 manifest" && git push
```

`verify-deployment.mjs` memeriksa:
- bytecode + codehash semua kontrak Perm (Router, V4, V3, V2, WETH adapter);
- codehash dependensi (PoolManager, Quoter, StateView, Permit2, WETH, v3 Factory/SwapRouter02/QuoterV2);
- owner, treasury, quote signer (EOA khusus, ≠ owner), pause guardian, `paused == false`;
- fee policy 20/2500;
- adapter enabled + providerId + codehash ter-pin;
- binding adapter → PoolManager/SwapRouter02/factory V2/WETH/router ini;
- Aggregator Hook: hook provider aktif, codehash tiap hook tidak berubah dan ter-pin di `PermV4Adapter`, versi `SlipstreamAggregator v1.0`, semua pool hook di manifest memakai hook yang ter-pin;
- status verifikasi Blockscout.

Env opsional memperluas pemeriksaan: `SIGNER_HEALTH_URL`, `PERM_APP_URL`, `RECORDING_WALLET`.

---

## 3 · Remote quote signer

Di 4663 web app **hanya** menerima `PERM_QUOTE_SIGNER_MODE=remote`. Key lokal/burner ditolak (fail closed). Service ada di `services/quote-signer/` (lihat README di sana).

### 3.1 Buat key signer khusus

```bash
cast wallet new                     # Foundry; atau:
node -e 'const {generatePrivateKey,privateKeyToAccount}=require("viem/accounts");const k=generatePrivateKey();console.log(k, privateKeyToAccount(k).address)'
openssl rand -hex 32                # PERM_QUOTE_SIGNER_TOKEN (≥32 karakter; dipakai di signer DAN web app)
```

Simpan private key hanya di secret store host signer. Alamatnya dipakai sebagai `QUOTE_SIGNER_ADDRESS`.

### 3.2 Deploy service

**Opsi A — Vercel, project terpisah (disarankan).**

1. Vercel → *Add New Project* → repo yang sama.
2. Set **Root Directory = `services/quote-signer`**, Framework = *Other*.
3. Isi env (Production):

| Env | Nilai |
|---|---|
| `SIGNER_PRIVATE_KEY` | key dari §3.1 |
| `PERM_QUOTE_SIGNER_TOKEN` | hasil `openssl rand -hex 32` |
| `SIGNER_CHAIN_ID` | `4663` |
| `SIGNER_ROUTER_ADDRESS` | `permRouter` dari manifest |
| `SIGNER_EXPECTED_ADDRESS` | alamat signer (pemeriksaan silang) |
| `SIGNER_ACCOUNT_ALLOWLIST` | alamat recording wallet (koma bila >1) |
| `SIGNER_MAX_AMOUNT_IN_WEI` | mis. `50000000000000000` (0,05 ETH) |

URL hasilnya:
- endpoint tanda tangan `https://<signer-project>.vercel.app/api/sign`;
- health = `GET` ke URL yang sama, yang mengembalikan `{ok,address,chainId,router}` tanpa rahasia.

**Opsi B — Node host (Render / Fly / Railway / VPS).**

```bash
cd services/quote-signer && npm install --omit=dev && npm test && npm start   # PORT=8787, HOST=0.0.0.0
```

Taruh di belakang TLS (Caddy, atau proxy bawaan host), atau set `TLS_CERT_FILE`/`TLS_KEY_FILE`. Endpoint: `POST /sign`, `GET /health`.

> **Batas custody.** Service ini menyimpan `SIGNER_PRIVATE_KEY` di secret store host (Vercel/Render). Itu memadai untuk mode **`allowlisted-mainnet`**: non-release, hanya wallet allowlist, dengan batas jumlah, dan cukup untuk rekaman showcase. Itu **bukan** custody KMS/HSM non-exportable yang diwajibkan gate release publik (README "Quote signing", `pnpm release:probe-signer`). Sebelum dibuka untuk semua wallet, ganti backend signer ke KMS/HSM dengan kontrak HTTP yang sama.

Kebijakan signer, semuanya **fail closed**:
- bearer token timing-safe;
- skema EIP-712 Perm persis (domain `{Perm, 2, 4663, router}`, 13 field);
- chain dan router terkunci;
- `deadline` maksimal 180 detik ke depan dan `quotedAt` tidak dari masa depan;
- allowlist akun (403);
- batas jumlah;
- self-recovery check;
- rate limit per IP dan audit log JSON (`signed`/`rejected`).

### 3.3 Daftarkan alamat signer on-chain

Bila alamat sudah dipakai saat deploy (§2.2), tidak perlu tindakan apa pun. Cukup cocokkan:

```bash
SIGNER_HEALTH_URL=https://<signer-project>.vercel.app/api/sign pnpm mainnet:verify   # bagian 6
```

Bila signer baru atau rotasi, kirim `setQuoteSigner` dengan **owner key**:

```bash
export MAINNET_DEPLOYER_PRIVATE_KEY=0x…   # owner
ACTION=status pnpm mainnet:admin
CONFIRM_MAINNET=1 ACTION=set-quote-signer QUOTE_SIGNER_ADDRESS=0xSIGNER pnpm mainnet:admin
unset MAINNET_DEPLOYER_PRIVATE_KEY
git add deployments/robinhood-mainnet.json && git commit -m "chore: rotate Perm quote signer"
```

Skrip menolak alamat yang punya bytecode (harus EOA/KMS), menolak key yang bukan owner, lalu memperbarui manifest.

> Catatan panjang token: web app menerima `PERM_QUOTE_SIGNER_TOKEN` minimal 16 karakter, sedangkan signer mewajibkan **minimal 32**. Pakai `openssl rand -hex 32` (64 karakter) di keduanya.

---

## 4 · Env Vercel web app (project utama)

*Settings → Environment Variables → Production*, lalu **Redeploy** karena variabel `NEXT_PUBLIC_*` dibaca saat build.

| Env | Nilai | Catatan |
|---|---|---|
| `NEXT_PUBLIC_PERM_CHAIN_ID` | `4663` | Mengaktifkan build mainnet: manifest `robinhood-mainnet.json`, token list 14 Stock Token (AMZN, NFLX, MSFT lewat USDG hub), registry `deployments/mainnet/v4-pools.json`, Uniswap V3 sebagai venue v3, copy "Robinhood Chain". |
| `RH_MAINNET_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` (atau RPC privat) | RPC publik tidak archive dan rate-limited (429). RPC privat disarankan untuk hari rekaman. |
| `RH_MAINNET_FALLBACK_RPC_URL` | RPC kedua | Diperlukan agar `/api/health` = staging-ready. |
| `NEXT_PUBLIC_PERM_ROUTER_ADDRESS` | `permRouter` | Wajib diisi eksplisit untuk mode allowlisted. |
| `NEXT_PUBLIC_PERM_V4_ADAPTER_ADDRESS` | `v4Adapter` | |
| `NEXT_PUBLIC_PERM_V3_ADAPTER_ADDRESS` | `v3Adapter` | |
| `NEXT_PUBLIC_PERM_ROUTER_VERSION` | `2` | |
| `NEXT_PUBLIC_PERM_DEPLOYMENT_BLOCK` | `deploymentBlock` dari manifest | |
| `PERM_EXECUTION_MODE` | `allowlisted-mainnet` | Isi juga `NEXT_PUBLIC_PERM_EXECUTION_MODE` dengan nilai yang sama. |
| `PERM_STAGING_CHAIN_ID` | `4663` | |
| `PERM_STAGING_WALLET_ALLOWLIST` | recording wallet (koma, maks. 64) | §6 |
| `PERM_QUOTE_SIGNER_MODE` | `remote` | |
| `QUOTE_SIGNER_ADDRESS` | alamat signer | Harus = `PermRouter.quoteSigner()`. |
| `PERM_QUOTE_SIGNER_URL` | `https://<signer>/api/sign` atau `/sign` | Wajib https. |
| `PERM_QUOTE_SIGNER_TOKEN` | token yang sama dengan signer | |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | project id | Untuk health staging-ready dan wallet mobile. |
| `PERM_STAGING_E2E_TX_HASH`, `NEXT_PUBLIC_PERM_STAGING_E2E_PASSED` | **kosongkan dulu** | Diisi di §6.3 setelah smoke test. |
| `PERM_MAINNET_ENABLE_AGGREGATOR_HOOKS` + `NEXT_PUBLIC_PERM_ENABLE_AGGREGATOR_HOOKS` | `1` (opsional) | Mengaktifkan route Uniswap Aggregator Hook. Butuh `wethAdapter` + `aggregatorHooks` di manifest (otomatis dari deploy). Pool hook hanya dibaca dari manifest, tidak bisa di-override lewat env. |
| `NEXT_PUBLIC_PERM_WETH_ADAPTER_ADDRESS` | `wethAdapter` (opsional) | Default diambil dari manifest. |
| `PERM_MAINNET_ENABLE_UNISWAP_V2` + `NEXT_PUBLIC_PERM_ENABLE_UNISWAP_V2` | `1` (opsional) | Mengaktifkan kandidat Uniswap V2. |
| `NEXT_PUBLIC_PERM_V2_ADAPTER_ADDRESS` | `v2Adapter` (opsional) | Default diambil dari manifest. |

AMZN, NFLX, dan MSFT tidak butuh env tambahan: route USDG hub selalu aktif di build 4663.

**Jangan** set `PERM_QUOTE_SIGNER_PRIVATE_KEY` atau burner apa pun di project web app.

Setelah redeploy, cek:

```bash
PERM_APP_URL=https://www.useperm.xyz SIGNER_HEALTH_URL=https://<signer>/api/sign pnpm mainnet:verify
```

Pada tahap ini `/trade` menampilkan "Execution not enabled yet". Itu disengaja: UI baru terbuka setelah smoke test (§6.3), sedangkan `/api/quote` sudah berfungsi untuk smoke test.

---

## 5 · Fee policy (0,20% gross, 25% fee rebate)

- Fee policy **dipublikasikan on-chain di constructor** `PermRouter` (tx deploy pertama, tercatat di `manifest.feePolicy.publishedInTx`). Tidak ada tx terpisah.
- Verifikasi:
  - `pnpm mainnet:verify` (bagian 3), atau
  - Blockscout → PermRouter → *Read contract* → `activePolicyVersion()` lalu `feePolicies(1)`, hasilnya harus `20, 2500, true, true`.
- Perhitungan contoh 0,001 ETH:
  - gross 0,000002 ETH;
  - fee rebate 0,0000005 ETH (25% dari gross);
  - fee bersih 0,0000015 ETH (0,15% efektif).

  Halaman `/rebate` membaca nilai dari kontrak.
- Saat narasi, sebut "fee rebate", bukan cashback.

---

## 6 · Allowlist + smoke test terkecil

### 6.1 Allowlist

Masukkan recording wallet di **dua** tempat:
- `PERM_STAGING_WALLET_ALLOWLIST` di web app (§4);
- `SIGNER_ACCOUNT_ALLOWLIST` di signer (§3.2).

Redeploy keduanya. Wallet di luar allowlist akan mendapat quote non-eksekusi dari app dan 403 dari signer.

```bash
RECORDING_WALLET=0xREC pnpm mainnet:verify      # saldo ≥ 0,003 ETH, peringatan bila wallet punya kode (EIP-7702)
```

### 6.2 Smoke swap 0,001 ETH → NVDA

Jalankan di mesin Anda dengan key recording wallet. Skrip ini **tidak** mengirim apa pun tanpa `CONFIRM_MAINNET=1`.

```bash
export SMOKE_PRIVATE_KEY=0x…                              # recording wallet; jangan ditempel di mana pun
PERM_APP_URL=https://www.useperm.xyz pnpm mainnet:smoke                      # dry run: quote + EIP-712 + previewFees + simulasi
PERM_APP_URL=https://www.useperm.xyz CONFIRM_MAINNET=1 pnpm mainnet:smoke    # kirim 1 tx
unset SMOKE_PRIVATE_KEY
```

Opsi: `SMOKE_TOKEN=NVDA`, `SMOKE_AMOUNT_ETH=0.001`, `SMOKE_SLIPPAGE_BPS=100`, `SMOKE_ROUTING_MODE=best|v4|v3|v2|hooks`.

Smoke tambahan sebelum merekam venue baru (masing-masing 1 tx 0,001 ETH):

```bash
SMOKE_ROUTING_MODE=hooks SMOKE_TOKEN=NVDA SMOKE_OUTPUT=deployments/mainnet/smoke-hook.json  PERM_APP_URL=… CONFIRM_MAINNET=1 pnpm mainnet:smoke
SMOKE_ROUTING_MODE=v3    SMOKE_TOKEN=AMZN SMOKE_OUTPUT=deployments/mainnet/smoke-amzn.json  PERM_APP_URL=… CONFIRM_MAINNET=1 pnpm mainnet:smoke
SMOKE_ROUTING_MODE=v2    SMOKE_TOKEN=SPY  SMOKE_OUTPUT=deployments/mainnet/smoke-v2.json    PERM_APP_URL=… CONFIRM_MAINNET=1 pnpm mainnet:smoke
```

Untuk `PERM_STAGING_E2E_TX_HASH` (§6.3) tetap pakai smoke v4 NVDA yang pertama.

Skrip memeriksa secara berurutan:
1. Saldo wallet.
2. Fee policy on-chain.
3. `/api/quote` di chain 4663 dan executable.
4. Route hanya memakai adapter dari manifest.
5. Rebuild EIP-712 lokal sama dengan `quoteId`, dan signature me-recover ke `PermRouter.quoteSigner()`.
6. Fee sama dengan `previewFees`.
7. `simulateContract`, lalu tx dikirim.
8. `SwapSettled` (quoteId, fee, `amountOut ≥ min`).
9. `/api/receipts?tx=` menampilkan receipt (menunggu 12 konfirmasi).

Hasilnya tersimpan di `deployments/mainnet/smoke-test.json`, termasuk link Blockscout.

Bila RPC yang dipakai `localhost` (fork), output otomatis masuk ke `*.rehearsal.json` dan link diberi label FORK. Hash fork tidak boleh dipakai sebagai bukti.

### 6.3 Buka UI eksekusi

Di Vercel web app, isi lalu **Redeploy**:
- `PERM_STAGING_E2E_TX_HASH = <hash dari smoke-test.json>`
- `NEXT_PUBLIC_PERM_STAGING_E2E_PASSED = 1`

Health memvalidasi hash tersebut: tx canonical, dari akun allowlist, route direct (atau wrap WETH + hook ter-pin bila hook diaktifkan), cukup konfirmasi. Setelah itu tombol swap di `/trade` aktif untuk wallet allowlist.

```bash
PERM_APP_URL=https://www.useperm.xyz pnpm mainnet:verify     # bagian 7: "app status staging-ready-non-release"
```

---

## 7 · Checklist sebelum take utama

- [ ] `pnpm mainnet:verify` dengan `PERM_APP_URL`, `SIGNER_HEALTH_URL`, `RECORDING_WALLET` → 0 gagal; ketiga kontrak terverifikasi di Blockscout.
- [ ] Smoke tx terbuka di Blockscout (status Success, event `SwapSettled`) dan muncul di `/proofs`.
- [ ] Token yang direkam hanya yang lolos audit:
  - via v4: NVDA, TSLA, SPCX, GOOGL, META, SPY;
  - via v3: NVDA, AAPL, SPCX, SPY, TSLA, META, PLTR, AMD, QQQ, COIN;
  - via USDG hub (2 langkah v3): AMZN, NFLX, MSFT. Round trip ±0,6%, jadi pakai jumlah kecil dan slippage ≥ 1%;
  - via Uniswap Aggregator Hook (bila diaktifkan): NVDA, AAPL, SPCX, SPY.
- [ ] Untuk NVDA, quote v3 (pool 0,05%) sedikit lebih baik dari v4 (fork: 0,012888508 vs 0,012884870 NVDA). Biarkan angka live yang bicara; jangan klaim "best price" atau "always cheapest".
- [ ] Route terpilih memakai output **setelah gas** (gas-adjusted). Kandidat dengan `amountOut` mentah sedikit lebih besar bisa kalah karena gas. Ini perilaku normal dan bisa dijelaskan sebagai "net of gas".
- [ ] Copy dan narasi:
  - "Stock Token" ≠ saham;
  - "fee rebate";
  - tanpa "audited", "guaranteed", "hook-powered", "MEV-free";
  - route hook disebut **"Uniswap Aggregator Hook (sumber Slipstream)"**. Jangan sebut "Perm hook" atau "hook milik Perm": hook itu milik Uniswap Labs, Perm hanya mem-pin codehash-nya. Sebutkan bahwa route hook menanggung protocol fee Uniswap (default 10 bps) yang sudah termasuk di angka quote;
  - jangan klaim Synthra di mainnet; venue v3 di 4663 adalah Uniswap v3;
  - USDG dan WETH hanyalah token perantara (hop), bukan token yang dijual Perm.

  Catatan: landing page memuat kalimat *No "always cheapest" claim*. Itu disclaimer, tetapi hindari close-up bila ingin aman.
- [ ] Jangan rekam `/setup`, env Vercel, dashboard signer, terminal yang berisi key.
- [ ] Quote berlaku 90 detik (`deadline = quotedAt + 90`). Klik swap segera setelah quote muncul. Bila quote kedaluwarsa, signer menolak (422) dan UI meminta quote ulang.

---

## 8 · Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| `/api/quote` 503 "could not validate an executable route" | Signer menolak atau RPC gagal | Lihat log Vercel. `Remote quote signer returned HTTP 4xx` → lihat audit log signer. |
| Signer 401 "unauthorized" | Token beda | Samakan `PERM_QUOTE_SIGNER_TOKEN` di kedua project. |
| Signer 403 "account is not on the signer allowlist" | Wallet tidak ada di `SIGNER_ACCOUNT_ALLOWLIST` | Tambah alamat, redeploy signer. |
| Signer 422 "quote already expired" / "amountIn exceeds the signer cap" | Quote > TTL, RPC sangat lambat, atau jam server melenceng | Pakai RPC privat dan cek NTP host signer (`SIGNER_MAX_CLOCK_SKEW_SECONDS`). Untuk cap: naikkan `SIGNER_MAX_AMOUNT_IN_WEI`. |
| Signer 422 "domain verifyingContract is not the pinned PermRouter" / "domain chainId must be 4663" | `SIGNER_ROUTER_ADDRESS`/`SIGNER_CHAIN_ID` salah atau lama | Isi alamat router dari manifest. |
| Quote `executable:false` "key does not match the onchain authorized signer" | `QUOTE_SIGNER_ADDRESS` ≠ `quoteSigner()` | §3.3 `set-quote-signer`, atau perbaiki env. |
| HTTP 429 dari RPC | RPC publik di-rate-limit Cloudflare | Set `RH_MAINNET_RPC_URL` privat + fallback. Pool v3 di-cache 24 jam (hit) / 5 menit (miss). |
| `/trade` "Execution not enabled yet" | E2E belum dideklarasikan | §6.3. |
| `claim-fees` "Nothing claimable for 0x…" | Dikirim dengan key owner | Klaim dengan key **treasury**/referrer, yaitu beneficiary. Setelah `set-treasury`, fee lama tetap milik treasury **lama**. |
| `routingMode: hooks` 422 "Aggregator Hook routing is disabled" | Flag hook tidak diset | Set dua env hook (§4) dan redeploy. |
| Kandidat hook hilang dari quote | Codehash hook berubah atau pin dicabut | `ACTION=status` menampilkan `PIN MISMATCH`/`not pinned`. Jalankan ulang `discover-aggregator-hooks.mjs`, cek manual, lalu `set-hook`. |
| AMZN/NFLX/MSFT "No executable route" di mode `v4` | Token hanya punya likuiditas v3 lewat USDG | Pakai mode `best` atau `v3`. |

---

## 9 · Operasi dan darurat

```bash
ACTION=status pnpm mainnet:admin                                             # read-only
CONFIRM_MAINNET=1 ACTION=pause pnpm mainnet:admin                            # owner atau pause guardian
CONFIRM_MAINNET=1 ACTION=unpause pnpm mainnet:admin                          # owner saja
CONFIRM_MAINNET=1 ACTION=claim-fees RECIPIENT=0x… pnpm mainnet:admin         # key treasury
```

### 9.1 Referral

```bash
CONFIRM_MAINNET=1 ACTION=configure-referral REFERRER_ADDRESS=0xREF REFERRAL_SHARE_BPS=5000 pnpm mainnet:admin   # 50% dari fee BERSIH
CONFIRM_MAINNET=1 ACTION=configure-referral REFERRER_ADDRESS=0xREF REFERRAL_SHARE_BPS=0 pnpm mainnet:admin      # hapus referrer
```

- Share dihitung dari fee **bersih** (setelah fee rebate). Contoh 0,001 ETH, 50%: gross 0,000002 → rebate 0,0000005 → bersih 0,0000015 → referrer 0,00000075 ETH, treasury 0,00000075 ETH.
- Link referral: `https://www.useperm.xyz/trade?referrer=0xREF`. UI membaca `referralShares()` dari Router; alamat yang belum dikonfigurasi tampil sebagai "not an active Router referral". Self-referral ditolak.
- Referrer mengklaim sendiri: `ACTION=claim-fees` dengan key referrer.
- Gunakan wallet referrer yang terpisah dari owner dan recording wallet.

### 9.2 Ganti treasury

```bash
CONFIRM_MAINNET=1 ACTION=set-treasury TREASURY_ADDRESS=0xNEW pnpm mainnet:admin
```

Hanya fee **baru** yang masuk ke treasury baru. Fee yang sudah terkumpul tetap bisa diklaim oleh treasury lama (skrip mencetak jumlahnya), jadi klaim dulu dengan key treasury lama bila perlu.

### 9.3 Pindah ownership (dua langkah)

```bash
CONFIRM_MAINNET=1 ACTION=transfer-ownership NEW_OWNER=0xMULTISIG pnpm mainnet:admin   # Router + V4 + V3 + V2 → pending
# NEW_OWNER EOA:
MAINNET_DEPLOYER_PRIVATE_KEY=<key owner baru> CONFIRM_MAINNET=1 ACTION=accept-ownership pnpm mainnet:admin
# NEW_OWNER multisig/Safe: kirim acceptOwnership() (selector 0x79ba5097) ke tiap alamat yang dicetak skrip
```

- Owner lama tetap berkuasa sampai `acceptOwnership()`; alamat salah bisa dibatalkan dengan `transfer-ownership` ulang.
- `PermWethAdapter` tidak punya owner (hanya bisa dipanggil PermRouter).
- Setelah pindah, semua aksi owner (`set-treasury`, `configure-referral`, `set-quote-signer`, `unpause`, `set-hook`, …) harus dikirim dari owner baru. `pause` tetap bisa oleh pause guardian.

### 9.4 Venue on/off (kill switch)

```bash
CONFIRM_MAINNET=1 ACTION=set-adapter ADAPTER=v2 ENABLED=0 pnpm mainnet:admin          # v4 | v3 | v2 | weth
CONFIRM_MAINNET=1 ACTION=set-hook-provider ENABLED=0 pnpm mainnet:admin               # semua langkah Aggregator Hook off
CONFIRM_MAINNET=1 ACTION=set-hook HOOK=0xA117… VERIFIED=0 pnpm mainnet:admin          # cabut pin satu hook
```

`set-hook VERIFIED=1` hanya menerima hook yang ada di `manifest.verifiedHooks` dengan codehash live yang sama.

Rotasi signer bila key bocor:
1. `pause`.
2. Buat key baru (§3.1).
3. Ganti env signer dan `QUOTE_SIGNER_ADDRESS` web app.
4. `set-quote-signer`.
5. `unpause`.

Quote lama tidak bisa dipakai ulang karena `consumedQuotes` dan deadline 90 detik.

---

## Lampiran · Rehearsal end-to-end di fork

```bash
pnpm mainnet:fork-e2e                          # anvil fork 4663 + signer HTTPS + app mode mainnet + deploy + smoke swap
SMOKE_ROUTING_MODE=best pnpm mainnet:fork-e2e  # lihat catatan di bawah
```

Memerlukan Foundry (`anvil`). Semua key di skrip ini adalah key uji publik atau ephemeral, dan semua hash hanya ada di fork.

RPC publik hanya menyimpan state ±4.000–6.000 blok (±7–10 menit) dan me-rate-limit. Akibatnya:
- mode `best` di fork yang masih dingin bisa melewati TTL 90 detik, dan signer menolaknya dengan benar sebagai expired;
- di RPC asli, quote yang sama selesai ±3 detik.

Karena itu default skrip adalah `v4`. Jalur v3 tercakup oleh `pnpm contracts:test:mainnet` (Klip 08).

Venue tambahan diuji satu per satu, masing-masing di fork baru (state RPC publik hanya bertahan ±7–10 menit, jadi satu fork tidak cukup untuk beberapa quote dingin):

```bash
SMOKE_ROUTING_MODE=v3    SMOKE_TOKEN=AMZN pnpm mainnet:fork-e2e   # ETH → USDG → AMZN (USDG hub)
SMOKE_ROUTING_MODE=v2    SMOKE_TOKEN=SPY  pnpm mainnet:fork-e2e   # ETH → USDG → SPY (Uniswap V2)
SMOKE_ROUTING_MODE=hooks SMOKE_TOKEN=NVDA pnpm mainnet:fork-e2e   # ETH → WETH → NVDA (Uniswap Aggregator Hook)
```

Selama run, manifest fork disalin ke `deployments/robinhood-mainnet.json` (app membaca pool hook dari sana). Placeholder yang di-commit dikembalikan saat skrip keluar. Skrip juga menolak jalan bila port 8545/8787/3100 masih dipakai proses lama.

Jalur on-chain semua venue ini juga tercakup di `pnpm contracts:test:mainnet` (fork in-process, tanpa web app).
