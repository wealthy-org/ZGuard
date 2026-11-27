# Progress penyesuaian tugas 21 Nov

Dokumen ini mencatat implementasi terhadap input `perm-tugas-21nov.md` tanpa mengubah release boundary Perm.

> Input menyebut commit `69b2dd9`, sedangkan workspace lokal yang tersedia berawal dari `ce175d7` dengan perubahan test-hook belum di-commit. Tidak ada GitHub atau remote repository yang diakses. Hasil di bawah mengacu pada source workspace aktual.

## Ringkasan

| ID | Status | Hasil |
|---|---|---|
| D1 — CI Slither | ✅ Selesai | Exact CI command sekarang menganalisis 82 contracts dengan 100 detectors dan 0 findings. |
| D2 — mainnet hook compatibility fork | ✅ Selesai | PermV4Adapter settle melalui hook `0xA1AD…2888`; canonical `HookSwap`, nonzero-hook `RouteStepSettled`, dan exact codehash terbukti. |
| D3 — same-pool comparison | ✅ Selesai | Tabel output, fee, rebate, gas, metode, dan batas klaim tersedia di `docs/TRADE_COMPARISON.md`. |
| D4 — live testnet fixture deployment | ⏳ Package selesai; live pending manual | Fail-closed runner, private operation journal, permanent post-evidence freeze, dan independent read-only verifier lulus fork E2E. Tidak ada transaksi live. |

## D1 — Slither CI

Enam finding direproduksi dengan command CI yang sama:

```bash
slither . --exclude-dependencies --filter-paths 'contracts/src/mocks|contracts/test'
```

Finding awal:

1. dua `uninitialized-local` pada callback currency/amount;
2. satu `reentrancy-events` pada exact-settlement path;
3. dua `assembly` untuk EIP-1153 `tstore`/`tload`; dan
4. satu `cyclomatic-complexity` pada `beforeSwap`.

Perbaikan:

- Callback direction direfactor menjadi boolean sign checks dan fully initialized ternary assignments.
- `reentrancy-events` dan `cyclomatic-complexity` diberi suppression sempit pada fungsi terkait dengan alasan bahwa transient active state dipasang sebelum immutable-venue call dan seluruh delta diverifikasi sebelum event.
- Dua penggunaan assembly diberi suppression sempit dengan alasan Solidity `0.8.26` belum memiliki high-level EIP-1153 syntax.
- `contracts/src/test` **tidak** dikeluarkan dari scan, sehingga fixture tetap masuk security analysis.

Hasil akhir:

```text
Slither 0.11.3
82 contracts
100 detectors
0 results
```

Refactor mengubah bytecode fixture, sehingga deterministic plan direproduksi ulang:

- predicted address: `0x4B6aDd241E2bF18Fdd570b664a8fc642Ff0D6888`;
- salt nonce: `6218`;
- init-code hash: `0x5d33494be3c63be9cf163d217a3e74ef1360e525ea2380c3bf7c9d2e15a78a63`; dan
- runtime codehash: `0x3908f518529f4e2e5b961cfed36d44df9c08eee2722cbd5c42e82043f964cdca`.

## D2 — PermV4Adapter vs candidate mainnet hook

Command:

```bash
corepack pnpm contracts:test:mainnet-hook
```

Hasil: **1 passing** pada local read-only chain-`4663` fork.

Containment dan evidence:

- hook: `0xA1AD09c98710d2C709e3bea03708823255312888`;
- hook runtime codehash: `0x537d4b59539aa00520d3f9885e00707e9a7bfe6670455ae54a3099e9b53129c7`;
- WETH/UP PoolId: `0x9ef343fe68e0702b7013a38444b2123e61e8cab2ede3f575a0d5b77cb1f8c95b`;
- external pool: `0x23D641FeCcD207E8794c593e8240444A0674C4Ba`;
- `HookSwap` berasal dari exact hook address;
- `RouteStepSettled.hook` nonzero dan sama dengan hook;
- `RouteStepSettled.hookCodehash` sama dengan reviewed runtime codehash; dan
- recipient menerima output aktual yang sama dengan `SwapSettled.amountOut`.

Provider test diberi identity `UNAPPROVED_MAINNET_HOOK_COMPATIBILITY`. Test menolak penggunaan sebagai admission evidence dan tidak mengirim transaksi mainnet.

## D3 — net output, fee, rebate, dan gas

Command reproduksi:

```bash
corepack pnpm contracts:compare:mainnet-hook
```

Pada source block `119976784`, input `0.001 WETH`, dan state WETH/UP hook pool yang sama:

| Jalur | Routed input | Gross fee | Rebate | Net fee | Output | Gas used |
|---|---:|---:|---:|---:|---:|---:|
| Perm Router v2 | 0.0009985 WETH | 0.000002 WETH | 0.0000005 WETH | 0.0000015 WETH | 16.486093291644107017 UP | 477,840 |
| Direct same-pool harness | 0.001 WETH | 0 | 0 | 0 | 16.510859559280844704 UP | 281,888 |

Direct menghasilkan `0.024766267636737687 UP` lebih banyak dan memakai `195,952` gas lebih sedikit pada snapshot ini. Ini konsisten dengan net platform fee Perm `0.15%` serta overhead signature/accounting/evidence. Gas tidak dikonversi ke UP tanpa conversion quote yang valid. Tidak ada klaim Perm selalu termurah.

Metode dan seluruh batas interpretasi tersedia di `docs/TRADE_COMPARISON.md`.

## D4 — live fixture deployment

Live operation belum dilakukan karena harus dijalankan manual oleh operator dari clean committed checkout dengan private key testnet-only yang tidak pernah diminta atau diterima di chat. Production Aggregator Hooks tetap disabled.

Package operator sekarang lengkap:

- `contracts:rehearse:test-hook` merehearsal seluruh alur pada latest-state fork tanpa public transaction;
- `contracts:deploy:test-hook` menolak wrong chain, dirty checkout, acknowledgement yang tidak exact, amount di luar `0.000001–0.001 WETH`, dan setiap drift address/hash/PoolKey/dependency;
- semua receipt yang submitted dicatat langsung ke private mode-`0600` operation journal;
- live path hanya memakai Router/adapter baru dengan provider `PERM_TEST_AGGREGATOR_HOOK`, bukan Router resmi atau staging;
- sesudah satu WETH→TSLA settlement, fee diklaim, balance Router/adapter wajib nol, Router di-pause, lalu ownership Router dan adapter dilepas permanen;
- caught failure setelah Router tersedia menjalankan best-effort emergency freeze dan tidak menghasilkan evidence yang valid; dan
- `staging:verify-test-hook` recompiles dari exact clean evidence commit dan memverifikasi seluruh canonical receipts/calldata/events, source deployment, current state, staging isolation, serta release boundaries.

Happy path dan caught-failure freeze sudah direhearsal. Verifier juga lulus end-to-end terhadap persistent local chain-`46630` fork. Hash lokal tidak dapat memenuhi D4. Runbook live lengkap: [`TEST_HOOK_EVIDENCE.md`](TEST_HOOK_EVIDENCE.md).

## Validasi akhir

| Gate | Hasil |
|---|---|
| `corepack pnpm check` | ✅ Lulus — 37 passing, 5 opt-in pending, build dan bundle checks lulus |
| `corepack pnpm contracts:test:fork` | ✅ 6 passing |
| `corepack pnpm contracts:test:mainnet-hook` | ✅ 1 passing |
| `corepack pnpm contracts:compare:mainnet-hook` | ✅ Comparison invariants lulus |
| Production coverage | ✅ 89.12% statements, 56.49% branches, 89.47% functions, 88.79% lines |
| Chain-46630 test-hook coverage | ✅ 100% statements, 60.64% branches, 100% functions, 97.89% lines; dedicated CI gate |
| D4 operator rehearsal | ✅ Happy path and caught-failure permanent freeze pass locally; no public evidence |
| D4 independent verifier rehearsal | ✅ Full verifier passes against persistent latest-state local fork; live/rehearsal distinction remains enforced |
| Production dependency audit | ✅ Clean |
| Full dependency audit | ✅ Exception-qualified: one low-severity development-only advisory with documented expiry |
| Exact Slither CI command | ✅ 82 contracts, 100 detectors, 0 findings |

Tidak ada live hook deployment, mainnet transaction, manifest promotion, Production hook enablement, atau perubahan `executionReady=false`.
