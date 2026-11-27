# Progress Keseluruhan Proyek Perm

> **Pembaruan:** 17 November 2026  
> **Status utama:** `staging-ready-non-release`  
> **Jaringan aktif:** Robinhood Chain Testnet (`46630`)  
> **Batas rilis:** Router v2 belum menjadi rilis resmi; mainnet tetap ditunda.

## 1. Ringkasan eksekutif

Perm sudah memiliki aplikasi, Router v2, adapter multi-venue, quote service, UI transaksi, indexer, release gate, serta bukti settlement nyata di testnet. Implementasi inti dan gate lokal saat ini lulus, tetapi proyek masih berada pada tahap **allowlisted testnet staging** karena governance, signer custody, operasi, assurance independen, WalletConnect manual, dan Aggregator Hook resmi belum memenuhi gate rilis.

| Area | Status | Ringkasan |
|---|---|---|
| Aplikasi web dan UX transaksi | ✅ Selesai secara engineering | Trade, routes, rebate, proofs, setup, docs, wallet injection, serta WalletConnect opsional tersedia. |
| Router v2 | ✅ Selesai dan staging-proven | Signed exact-input, multi-step, Permit2, fee/rebate, referral, pull claims, pause, dan settlement evidence sudah diuji. |
| Direct Uniswap v4 | ✅ Staging-proven | Settlement nyata dan fork dua arah tersedia. |
| Synthra v3 | ✅ Staging-proven | Settlement nyata, fork dua arah, serta Permit2 nyata tersedia. |
| Multi-hop dan cross-venue | ✅ Staging-proven | Token-to-token dan v4→v3 dua langkah sudah memiliki bukti canonical testnet. |
| Indexer dan history | 🟡 Implemented; operasi berkelanjutan belum menjadi release evidence | PostgreSQL/reorg-aware indexer tersedia dan pernah diverifikasi di staging. |
| WalletConnect | 🟡 Implemented; bukti manual tertunda | Verifier fail-closed tersedia, tetapi pairing mobile nyata dan attestation QA independen belum selesai. |
| V2 venue | ⛔ Withheld | Adapter dormant dan fork-compatible, tetapi venue gagal gate provenance, aktivitas, dan likuiditas. |
| Aggregator Hook resmi | ⛔ Withheld | Belum ada deployment resmi chain `46630` yang memenuhi provenance dan audit gate. |
| Perm test hook non-official | 🟡 Operator package lengkap; live pending | Fork/security/coverage, deterministic rehearsal, permanent stack freeze, private journal, dan independent verifier lulus lokal; belum ada transaksi live dan tidak boleh dianggap hook resmi. |
| Governance produksi | ⛔ Belum siap | Staging masih memakai owner/treasury/pause guardian satu EOA dan belum memakai timelock. |
| Remote quote signer | ⛔ Belum siap | Staging memakai burner signer testnet; KMS/HSM non-exportable belum dibuktikan. |
| Production release | ⛔ Diblokir | Manifest resmi tetap Router v1 dan `executionReady` tetap false untuk staging v2. |
| Mainnet | ⏸️ Ditunda | Tidak ada deployment mainnet yang diizinkan sebelum seluruh testnet dan assurance gate selesai. |

## 2. Batas rilis yang berlaku

### Manifest resmi

- Router resmi masih **Router v1**.
- Alamat resmi saat ini: `0x3e350b79D4983a0e86Ad4eE25dB1DBBbfB55114d`.
- Aggregator Hooks resmi: kosong.
- Source verification Router v1 masih tercatat `pending` pada manifest.
- Manifest ini tidak boleh diganti otomatis oleh candidate atau staging deployment.

### Router v2 staging

- Environment: `allowlisted-testnet-staging`.
- Status: `non-release`.
- URL staging: `https://perm-iota.vercel.app`.
- Router v2: `0xFdC667735C8998fEB83C4c3c7B4eCFB404DAFA87`.
- V4 adapter: `0x9F05AA13b333d4FB780c8A343f4663de9C9c798c`.
- V3 adapter: `0x1D608E676b3bF506d15f4C9Ee0fAAa9aC87ce6Ba`.
- Ketiga kontrak tercatat `verified-exact-match`.
- `executionReady: false` tetap wajib.
- Wallet allowlist tetap wajib.
- Burner signer testnet tetap diklasifikasikan `custodyReady: false`.
- Aggregator Hook provider tetap dinonaktifkan pada deployment staging yang berjalan.
- V2 adapter tidak dideploy dan tidak diregistrasikan.

## 3. Progress implementasi

### 3.1 Smart contracts

- [x] Router v2 dengan EIP-712 domain `Perm`, versi `2`.
- [x] Binding quote terhadap account, pair, input, minimum output, recipient, gas, deadline, quote time, policy, chain, referrer, dan route hash.
- [x] Proteksi forged quote, mutation, replay, stale/future quote, expiry, wrong chain, dan self-referral.
- [x] Maksimal empat route steps yang kontinu.
- [x] Pengukuran output aktual dan verifikasi output yang dilaporkan adapter.
- [x] Fee policy integer, rebate, treasury/referral accrual, dan pull claims.
- [x] Reserve-safe rescue untuk native dan ERC-20.
- [x] Pause guardian serta two-step ownership.
- [x] `RouteStepSettled` dan `SwapSettled` sebagai bukti settlement canonical.
- [x] Adapter Uniswap v4 direct.
- [x] Adapter Synthra v3 dengan native wrap/unwrap dan allowance cleanup.
- [x] Permit2 signature-transfer path.
- [x] Timelock contract dan ownership migration tooling.
- [x] Dormant V2 adapter dengan codehash/factory/pair containment.
- [x] Codehash pinning untuk adapter dan hook.
- [x] Isolated `PermTestAggregatorHook` untuk chain `46630`.

### 3.2 Routing dan quote service

- [x] Discovery pool v4 dari event `PoolManager.Initialize`.
- [x] Discovery incremental, finalized, overlap/reorg-aware.
- [x] Discovery Synthra v3 dari factory dan fee tiers yang direview.
- [x] Direct v4, direct v3, token-to-token, multi-hop, dan explicit mixed routing.
- [x] Ranking output setelah estimasi gas ketika unit conversion dapat dipercaya.
- [x] Price-impact estimate dari requote ukuran kecil.
- [x] Policy fee dan decimals diverifikasi ke chain.
- [x] TTL cache, in-flight RPC coalescing, request limits, dan timeout boundaries.
- [x] Quote signer lokal hanya untuk development/staging eksplisit.
- [x] Remote signer response recovery dan malformed-response rejection.
- [x] Production execution fail-closed ketika manifest, custody, atau evidence belum siap.
- [x] Hook route fail-closed ketika hook belum direview dan dipin.
- [x] V2 route fail-closed selama admission masih withheld.

### 3.3 Frontend dan wallet UX

- [x] Halaman trade, routes, rebate, proofs, setup, dan docs.
- [x] Injected wallet support.
- [x] Reown/WalletConnect integration opsional.
- [x] Routing mode Best, V4, Synthra v3, dan Verified Hooks.
- [x] Custom slippage dan price-impact warning.
- [x] Balance handling dan native gas reserve untuk MAX.
- [x] Stale-input guard dan requote setelah approval.
- [x] Full-call simulation sebelum wallet submission.
- [x] Exact approval atau Permit2.
- [x] Route comparison dan per-step proof display.
- [x] Production browser tidak dapat mengganti alamat deployment resmi.
- [ ] Pairing WalletConnect mobile nyata dan attestation QA independen.

### 3.4 Data, indexer, dan operasi

- [x] PostgreSQL schema untuk settlement history.
- [x] Reorg-aware per-router cursor.
- [x] Indexed history dengan bounded chain fallback.
- [x] Shared PostgreSQL token bucket.
- [x] Official dan staging target isolation.
- [x] Pool registry persistence.
- [x] Deployment/config/indexer monitor.
- [x] Optional webhook support.
- [x] Health gate terpisah untuk staging dan release execution.
- [x] Neon-backed staging history pernah diverifikasi.
- [ ] Continuous indexer schedule sebagai release evidence.
- [ ] Backup/restore dan load drill.
- [ ] Primary/fallback/archive RPC failover drill lengkap.
- [ ] Alert delivery nyata ke on-call destination.
- [ ] Monitoring tetap sengaja dinonaktifkan: `PERM_MONITOR_ENABLED=0`.

Hosted health terbaru mengembalikan `200 staging-ready-non-release` untuk `requireStaging=1` dan `503 executionReady=false` untuk `requireExecution=1`. Primary/fallback RPC, PostgreSQL indexer, shared rate limiter, WalletConnect configuration, dan canonical E2E check terdeteksi aktif; alert webhook tetap tidak dikonfigurasi dan signer custody tetap `staging-local`/not ready.

## 4. Bukti staging yang sudah tersedia

| Skenario | Status | Transaksi |
|---|---|---|
| Direct Uniswap v4 | ✅ Passed staging-only | `0xa74beb5b8d5c22aa8ea11d77f36a79070e9464439b033b83f99dd3c5c27251b5` |
| Synthra v3 | ✅ Passed staging-only | `0xdf2002f1aa676e56035206ed95113af4cfe141a3b2b6b6f3ee2bac2414b223fd` |
| Token-to-token multi-hop | ✅ Passed staging-only | `0x60849ff5a8253034866f529f9d42ec3a49f1bb496c1664be083a2f614e033032` |
| Cross-venue v4→v3 | ✅ Passed staging-only | `0x994b1b8ac83d8e3ae03d036c9d85cadc71e8b93e3144b8c6167d471716f77290` |
| Permit2 signature transfer | ✅ Passed staging-only | `0xa325c640cac9908081d569e8226f373c29724f2c8c4a97dc5c95a8a132a910e1` |
| Referral accrual | ✅ Passed staging-only | `0x7243055dea1a8e69b1b45e36ea6b636381d5f36532e0baafcbed43b3272e4cc8` |
| Treasury claim | ✅ Passed staging-only | `0x9582690dcf859b52cf957bd95ee3541de5ed72411a16941e5ca3828c10058974` |
| Referral claim | ✅ Passed staging-only | `0x9a785b45cea501a9a267ea19aecce3c246add410f81131dfa1d95070d7c31994` |
| WalletConnect mobile | ⏳ Pending | Pairing nyata dan attestation independen belum tersedia. |

Status suite: **8 dari 9 skenario staging telah direkam**. Bukti ini tidak memenuhi governance, custody, audit, assurance, atau official-release gate.

## 5. Perm test hook non-official

Fixture baru hanya ditujukan untuk membuktikan mekanisme Aggregator Hook di chain `46630`. Fixture ini **bukan** deployment resmi Uniswap, tidak boleh menutup provenance/audit gap, dan tidak boleh mengaktifkan Production Aggregator Hooks.

### Yang sudah lulus

- [x] Chain-ID guard untuk `46630`.
- [x] Canonical PoolManager address dan runtime codehash pin.
- [x] Immutable external Synthra WETH/TSLA venue dan runtime codehash pin.
- [x] Deterministic CREATE2 address dengan permission bits `0x2888`.
- [x] Canonical WETH/TSLA PoolKey initialization pada fork.
- [x] Synthra dan Uniswap callback entry points dengan shared authentication.
- [x] Callback sender, active context, PoolId, amount, direction, currency, dan one-payment checks.
- [x] Nested swap reentrancy dan callback replay containment.
- [x] Exact-input-only dan liquidity rejection.
- [x] Fail-closed external venue drift dan adapter hook-code drift.
- [x] Bidirectional WETH→TSLA dan TSLA→WETH settlement melalui Router v2.
- [x] Verifikasi `AggregatorPoolRegistered`, `HookSwap`, external `Swap`, `RouteStepSettled`, dan `SwapSettled`.
- [x] Wrong-chain, bad-key, unauthorized callback, partial payment, dan short-output negative tests.
- [x] Dedicated coverage gate terpisah dan wajib di CI.
- [x] Fail-closed live runner dengan exact acknowledgement, clean-commit binding, bounded amount, dan private operation journal.
- [x] Post-evidence fee cleanup, zero Router/adapter token balances, pause, serta permanent ownership renunciation.
- [x] Best-effort emergency freeze pada caught failure setelah isolated Router tersedia.
- [x] Independent verifier untuk exact deployment calldata, canonical receipts/events, live state, existing-staging isolation, dan unchanged manifests.
- [x] Happy-path, caught-failure, dan full verifier E2E rehearsal pada local latest-state fork.

### Deterministic plan saat ini

| Field | Value |
|---|---|
| Label | `Perm test hook - not an official Aggregator Hook` |
| CREATE2 deployer | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| Salt nonce | `6218` |
| Predicted address | `0x4B6aDd241E2bF18Fdd570b664a8fc642Ff0D6888` |
| Permission bits | `0x2888` |
| Init-code hash | `0x5d33494be3c63be9cf163d217a3e74ef1360e525ea2380c3bf7c9d2e15a78a63` |
| Expected runtime codehash | `0x3908f518529f4e2e5b961cfed36d44df9c08eee2722cbd5c42e82043f964cdca` |
| Current live status | **Belum dideploy** |

### Yang masih pending

- [ ] Review dan commit seluruh package sebagai satu commit.
- [ ] Reproduce planner, full gates, coverage, audit, Slither, dan rehearsal dari clean committed checkout.
- [ ] Manual live testnet operation oleh operator dengan key testnet-only yang tetap lokal.
- [ ] Canonical live hook deployment/PoolKey initialization jika address/pool masih vacant.
- [ ] Satu bounded WETH→TSLA settlement melalui Router/adapter baru yang sepenuhnya terisolasi; Production tetap disabled.
- [ ] Read-only live verification setelah confirmation depth yang dipilih.

Runbook: [D4 isolated test-hook evidence](docs/TEST_HOOK_EVIDENCE.md). Hook dan PoolKey bersifat permanent di testnet; isolated Router/adapter sengaja di-pause dan dibuat ownerless setelah evidence.

### Mainnet hook compatibility — read-only fork

- [x] Hook candidate `0xA1AD09c98710d2C709e3bea03708823255312888` diverifikasi ulang terhadap runtime codehash `0x537d4b59539aa00520d3f9885e00707e9a7bfe6670455ae54a3099e9b53129c7`.
- [x] `PermV4Adapter` berhasil settle WETH→UP melalui hook existing pada local chain-`4663` fork.
- [x] Test mewajibkan `HookSwap`, `RouteStepSettled` dengan hook nonzero, exact PoolId, dan exact hook codehash.
- [x] Provider diberi label `UNAPPROVED_MAINNET_HOOK_COMPATIBILITY`; tidak ada admission atau transaksi mainnet.
- [x] Same-state comparison terhadap direct same-pool baseline direkam di [TRADE_COMPARISON.md](docs/TRADE_COMPARISON.md).
- [ ] Provenance resmi dan audit artifact tetap belum tersedia; mainnet deployment tetap dilarang.

## 6. Status pengujian terbaru

### Gate aplikasi lengkap

Command terakhir:

```bash
corepack pnpm check
```

Hasil pada 17 November 2026: **lulus**.

- ESLint: lulus tanpa warning.
- TypeScript: lulus.
- Contract unit/security/invariant: **37 passing, 5 fork suites pending secara opt-in**.
- Server runtime tests: lulus.
- Route planner tests: lulus.
- Staging policy dan quote-signer tests: lulus.
- Wallet provider recovery tests: lulus.
- Release, assurance, evidence, operations, WalletConnect attestation, manifest, V2 review, dan indexer regressions: lulus.
- Next.js production build: lulus.
- Production bundle containment: lulus pada 450 build files.

### Latest-state fork suite

```bash
corepack pnpm contracts:test:fork
```

Hasil terbaru: **6 passing**.

1. Direct v4 dua arah.
2. Synthra v3 dan Permit2 nyata.
3. Dormant V2 compatibility.
4. Perm test hook settlement dua arah dan canonical events.
5. Hook negative/security boundaries.
6. Callback replay, reentrancy, wrong currency, partial payment, dan short output containment.

Read-only mainnet compatibility fork:

```bash
corepack pnpm contracts:test:mainnet-hook
corepack pnpm contracts:compare:mainnet-hook
```

Hasil: **1 compatibility test passing**. Pada source block `119976784` same-state WETH/UP benchmark, Perm menghasilkan `16.486093291644107017 UP` setelah net platform fee `0.15%`, sedangkan direct same-pool harness menghasilkan `16.510859559280844704 UP`; Perm menggunakan `195,952` gas lebih banyak. Gas tetap dilaporkan terpisah dari output token.

### Checkpoint security tambahan

- Production-scope Solidity coverage terbaru: **89,12% statements; 56,49% branches; 89,47% functions; 88,79% lines**.
- Chain-46630 test-hook coverage terpisah: **100% statements; 60,64% branches; 100% functions; 97,89% lines**. Pemisahan diperlukan karena fixture menolak deployment pada default unit-test chain `31337`; fork coverage tetap wajib, sekarang menjadi dedicated CI gate, dan tidak menggantikan production coverage.
- Slither `0.11.3` terbaru: **82 contracts, 100 detectors, 0 findings**. Fixture hook tetap dipindai; dua false-positive uninitialized locals diselesaikan lewat refactor, sedangkan empat finding struktural diberi suppression sempit beserta alasan EIP-1153 dan exact-settlement sequencing.
- Production dependency audit: **clean**. Full dependency audit hanya memiliki satu exception low-severity development-only `GHSA-848j-6mx2-7j84`, tanpa patched upstream release, berlaku hingga 15 Januari 2027.

## 7. Blocker rilis yang masih terbuka

### Blocker kritis

1. **Official Aggregator Hook provenance/audit** — fixture Perm tidak boleh digunakan sebagai pengganti.
2. **Governance separation** — owner, treasury, pause guardian, dan proposer harus memakai identitas terpisah yang direview.
3. **Timelock** — minimum 48 jam dan ownership acceptance belum ada pada deployment staging saat ini.
4. **Remote signer custody** — perlu KMS/HSM non-exportable, rotation, dan emergency-disable evidence.
5. **Independent audit** — local tests dan Slither bukan audit pihak ketiga.
6. **Bug bounty** — perlu policy publik dan funding evidence.
7. **Incident drills** — pause, signer compromise, RPC failover, dan indexer reorg drills belum direkam.
8. **Four-role approvals** — engineering, security, governance, dan operations harus berbeda dan menandatangani candidate digest final.
9. **WalletConnect mobile evidence** — pairing nyata dan independent QA attestation masih pending.
10. **Hosted operations assurance** — schedule, backup/restore, load, failover, dan alert delivery belum lengkap.

### Fitur yang sengaja ditahan

- V2 venue admission.
- Official Aggregator Hook routing.
- Public unrestricted execution.
- Production promotion.
- Mainnet deployment.
- Monitoring alerts, sesuai keputusan operator saat ini.

## 8. Roadmap dari posisi sekarang

### P0 — selesaikan perubahan test hook

1. Review diff fixture, planner, runner/verifier, tests, CI, dan dokumentasi.
2. Commit seluruh perubahan sebagai satu commit terikat.
3. Jalankan ulang planner, `pnpm check`, fork suite, kedua coverage gate, audit, Slither, dan rehearsal dari checkout bersih.

### P1 — pembuktian live testnet fixture

1. Baca dan ikuti [`docs/TEST_HOOK_EVIDENCE.md`](docs/TEST_HOOK_EVIDENCE.md); pahami 12–14 public testnet transactions dan irreversible hook/PoolKey writes.
2. Jalankan hanya dari exact clean commit dengan key testnet-only yang dikonfigurasi lokal serta exact non-official acknowledgement.
3. Biarkan runner mencocokkan address, init-code/runtime hashes, immutables, label, PoolKey, dependencies, dan amount bound sebelum/selama operasi.
4. Gunakan hanya Router/adapter baru dengan provider identity `PERM_TEST_AGGREGATOR_HOOK`; existing official/staging Routers tidak disentuh.
5. Pertahankan Production provider, kedua manifest, dan `executionReady` dalam keadaan disabled/unchanged/false.
6. Rekam satu bounded WETH→TSLA canonical settlement, bersihkan fee/balance, lalu pause dan renounce ownership stack terisolasi secara permanen.
7. Hapus key dari shell dan jalankan read-only verifier pada confirmation depth yang dipilih; jangan rerun deployment bila hanya confirmations yang kurang.

### P2 — tutup blocker Router-v2 release

1. Selesaikan WalletConnect manual.
2. Sediakan multisig/timelock dan role separation.
3. Migrasikan quote signing ke KMS/HSM.
4. Operasikan indexer/RPC failover/monitor secara berkelanjutan.
5. Rekam alert dan incident drills.
6. Dapatkan audit, bug bounty, custody attestation, dan four-role approvals.
7. Buat candidate bersih dan jalankan semua verifier sebelum promotion.

### P3 — mainnet

Mainnet hanya boleh dimulai setelah seluruh gate testnet dan release di atas lulus. Mainnet memerlukan manifest, address book, dependency review, fork tests, governance, economic limits, legal review, dan evidence package yang terpisah. Tidak ada alamat testnet yang boleh disalin sebagai default mainnet.

## 9. Status repository saat dokumen ini dibuat

- Branch: `main`.
- Base commit: `ce175d768881b1bc2dabebf7c66c2b3f498c1d23`.
- Working tree: **belum bersih** karena perubahan isolated test hook belum di-commit.
- Perubahan aktif mencakup source hook, adversarial mock, unit/fork/coverage tests, deterministic planner, fail-closed runner, independent verifier, CI gate, package scripts, serta runbook/dokumentasi hook.
- Tidak ada live hook deployment, public D4 transaction, atau perubahan deployment manifest dari pekerjaan ini.

## 10. Definition of done

### Testnet engineering complete

- Semua fitur kontrak/API/UI yang di-scope lulus unit, invariant, fork, build, dan security gates.
- Isolated hook live testnet mechanics terbukti tanpa mengubah Production routing.
- Tidak ada gap yang ditutup dengan relabeling, fixture palsu, atau evidence yang difabrikasi.

### Router-v2 official release complete

- Manifest candidate bersih dan reproducible.
- Governance, source, runtime, E2E, Aggregator Hook resmi, hosted operations, assurance, dan approvals seluruhnya `passed`.
- Promotion dilakukan eksplisit terhadap exact router address.

### Mainnet ready

- Semua testnet/release gates lulus.
- Independent reviewer menyetujui evidence package.
- Mainnet-specific address book, audit scope, governance, operations, economic limits, dan legal review selesai.

## 11. Dokumen rujukan

- [README](README.md)
- [Arsitektur Router v2](docs/ARCHITECTURE.md)
- [Deployment runbook](docs/DEPLOYMENT.md)
- [Allowlisted staging](docs/ALLOWLISTED_STAGING.md)
- [Gap closure record](docs/GAP_20NOV_CLOSURE.md)
- [Aggregator Hook research](docs/AGGREGATOR_HOOK_RESEARCH.md)
- [Hook onboarding policy](docs/HOOK_ONBOARDING.md)
- [V2 venue review](docs/V2_VENUE_REVIEW.md)
- [Mainnet readiness](docs/MAINNET_READINESS.md)
- [Release evidence](docs/RELEASE_EVIDENCE.md)
- [QA](docs/QA.md)
- [Perbandingan trade same-pool](docs/TRADE_COMPARISON.md)
- [Progress penyesuaian tugas 21 Nov](docs/TASKS_21NOV_PROGRESS.md)
