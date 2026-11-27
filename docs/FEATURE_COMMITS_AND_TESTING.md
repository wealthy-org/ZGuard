# Pesan commit per fitur dan runbook pengujian

Dokumen ini memetakan fitur terhadap commit yang sudah ada dan menjelaskan cara menguji seluruh permukaan Perm: kontrak, router, adapter, quote/API, UI, fork, bukti staging, WalletConnect, indexer, pool discovery, operasi, dan release gate.

> **Batas tetap:** manifest resmi masih Router v1. Router v2 hanya `allowlisted-testnet-staging`, `executionReady=false`. V2 venue dan Aggregator Hook tetap withheld. Jangan mengaktifkan schedule, monitor, V2, hook, atau promotion hanya karena pengujian lulus.

## 1. Commit aktual per fitur

Commit berikut benar-benar ada di branch `main`; jangan menulis ulang history hanya untuk memecah commit yang sudah dibuat.

| Fitur | Commit aktual | Pesan commit |
|---|---|---|
| Target indexer/monitor untuk allowlisted staging | `0363137` | `feat(operations): add allowlisted staging indexer and monitor` |
| Manifest publik Router-v2 non-release staging | `063d134` | `chore: publish allowlisted Router v2 staging record` |
| Review chain Aggregator Hook dan keputusan withhold | `09cfb2b` | `docs: record Aggregator Hook chain review` |
| Bukti v3, multi-hop, Permit2, referral, dan claims | `bbdca87` | `test: record Router v2 staging evidence suite` |
| Cross-venue v4→v3, review V2, dormant V2 adapter, dan gate UI/API | `bdb048a` | `feat: gate reviewed V2 and prove cross-venue routing` |
| Hardening V2 dormant dan refresh registry v4 | `6e4ed57` | `chore: harden dormant V2 and refresh pool registry` |
| Matriks penutupan gap feature-by-feature | `27ec212` | `docs: record feature-by-feature staging closure` |
| Flow attestation WalletConnect staging yang fail-closed | `f5016a4` | `feat: add fail-closed WalletConnect staging attestation flow` |
| Tautan dokumentasi verifier WalletConnect | `f8a7d02` | `docs: link WalletConnect manual verifier` |

## 2. Pesan commit granular untuk perubahan lanjutan

Jika fitur-fitur serupa dikembangkan lagi di branch baru, gunakan satu commit per concern. Pesan yang disarankan:

```text
feat(router): add signed multi-venue exact-input settlement
feat(v4): add direct no-hook Uniswap v4 routing
feat(v3): add Synthra v3 routing and settlement
feat(routing): add token-to-token multi-hop planning
feat(routing): add explicit v4-to-v3 cross-venue execution
feat(permit2): add signature-transfer input settlement
feat(fees): add rebate referral and pull-payment accounting
feat(staging): add wallet-allowlisted Router v2 execution mode
feat(indexer): add non-release Router v2 indexing target
feat(operations): add fail-closed staging health monitor
feat(walletconnect): add independent mobile-session attestation verifier
feat(v2): add dormant codehash-pinned adapter behind withheld admission
security(v2): bind adapter caller and recipient to the immutable router
test(staging): verify canonical multi-venue evidence suite
test(fork): cover v4 v3 Permit2 and dormant V2 integrations
chore(pools): refresh Robinhood v4 direct-pool registry
docs(hooks): record Aggregator Hook admission decision
docs(v2): record third-party V2 venue withhold decision
docs(qa): map gap-analysis items to evidence and blockers
```

Untuk commit V2, body commit wajib menjelaskan: **tidak di-deploy, tidak diregistrasikan, tidak diekspos, admission tetap withheld**.

## 3. Aturan keselamatan sebelum testing

1. Jalankan dari `/home/user/Perm`.
2. Gunakan Node 22.x; minimum proyek adalah Node 20.9.
3. Jangan memasukkan private key, token, URL database, credential-bearing RPC URL, webhook URL, atau WalletConnect session topic ke chat, Git, screenshot, atau log publik.
4. Simpan nilai sensitif hanya di environment lokal atau file ignored `.staging/` bermode `0600`.
5. Gunakan akun dan aset testnet saja.
6. Biarkan:
   - `NEXT_PUBLIC_PERM_EXECUTION_READY=0`;
   - `PERM_MONITOR_ENABLED=0`;
   - `PERM_AGGREGATOR_HOOKS_JSON=[]`;
   - V2 adapter tidak ter-deploy dan tidak terdaftar.
7. Bedakan tes read-only dari tes yang mengirim transaksi atau notifikasi nyata.

Periksa baseline:

```bash
cd /home/user/Perm
node --version
corepack pnpm --version
git status --short
```

Kriteria: working tree bersih sebelum tes; jangan lanjutkan release workflow dari tree yang tidak dikenal.

## 4. Instalasi deterministik

```bash
corepack enable
corepack pnpm install --frozen-lockfile
```

Kriteria: lockfile tidak berubah dan instalasi selesai tanpa error.

## 5. Gate lokal utama

Jalankan gate aman yang paling lengkap terlebih dahulu:

```bash
corepack pnpm check
```

Per checkpoint saat ini, hasil yang diharapkan:

- ESLint: nol warning;
- TypeScript: lulus;
- kontrak: **37 passing, 5 opt-in fork tests pending**;
- server runtime, planner, staging policy, quote signer: lulus;
- release-gate, assurance, evidence, WalletConnect, manifest, V2-review, indexer schema/target regressions: lulus;
- Next.js production build: lulus;
- bundle containment: lulus.

`check` belum mencakup audit dependency, coverage, PostgreSQL nyata, Slither, fork live-state, atau transaksi staging baru; jalankan bagian berikutnya juga.

## 6. Pengujian kontrak per fitur

### 6.1 Router, EIP-712, routing, Permit2, fees, referral, dan claims

```bash
corepack pnpm exec hardhat test contracts/test/PermRouter.test.cjs
```

Yang harus terbukti:

- quote mengikat chain, account, recipient, token, amount, minimum output, gas, timing, policy, referrer, dan route hash;
- forged/mutated/replayed/stale/future/expired/wrong-chain quote ditolak;
- rute hingga empat langkah kontinu dapat settle;
- Permit2 signature transfer bekerja;
- self-referral dan fee-on-transfer input ditolak;
- minimum-output failure dan reentrancy melakukan rollback atomik;
- fee rebate, treasury/referral accrual, claims, serta protected reserves konsisten;
- pause, signer rotation, dan two-step ownership bekerja.

### 6.2 Fuzz dan invariant accounting

```bash
corepack pnpm exec hardhat test contracts/test/PermRouterInvariant.test.cjs
```

Kriteria: 1.024 input fee deterministik dan skenario acak mempertahankan conservation, reserve, referral split, dan quote-consumption invariants.

### 6.3 Uniswap v4 adapter

```bash
corepack pnpm exec hardhat test contracts/test/PermV4Adapter.test.cjs
```

Kriteria:

- hanya immutable Perm Router yang boleh memanggil;
- route key harus cocok dengan token pair;
- no-hook pool menolak hook calldata;
- reviewed hook harus cocok dengan runtime codehash;
- native value mismatch ditolak;
- rescue hanya oleh governance.

### 6.4 Synthra v3 adapter

```bash
corepack pnpm exec hardhat test contracts/test/PermV3Adapter.test.cjs
```

Kriteria:

- exact ERC-20 input dan native wrap/unwrap berhasil;
- allowance external router kembali nol;
- fee tier dan price-limit yang tidak didukung ditolak;
- caller dan rescue dibatasi.

### 6.5 Dormant V2 adapter

```bash
corepack pnpm exec hardhat test contracts/test/PermV2Adapter.test.cjs
```

Kriteria:

- factory-selected direct pair dan dependency/pair codehash diperiksa;
- output hanya kembali ke immutable Perm Router;
- wrong caller, wrong recipient, wrong pair, changed code, reserve donation/balance drift, malformed route, dan fee-on-transfer behavior ditolak;
- native wrapping/unwrapping dan governance rescue diuji.

Lulusnya tes ini **tidak** mengizinkan deployment atau admission V2.

### 6.6 Timelock ownership

```bash
corepack pnpm exec hardhat test contracts/test/PermTimelock.test.cjs
```

Kriteria: ownership Router dan adapter baru dapat diterima secara batch setelah delay; sebelum delay harus gagal.

### 6.7 Artifact browser

```bash
corepack pnpm contracts:export
corepack pnpm exec hardhat test contracts/test/ArtifactIntegrity.test.cjs
```

Kriteria: runtime template dan browser artifact cocok di luar immutable slots yang dideklarasikan compiler.

### 6.8 Semua unit/invariant tests sekaligus

```bash
corepack pnpm contracts:test
```

Checkpoint saat ini: **37 passing, 5 pending**; lima pending adalah fork suites yang sengaja opt-in, termasuk isolated test hook dan read-only mainnet compatibility.

## 7. Server, planner, API policy, dan release regressions

```bash
corepack pnpm server:test
corepack pnpm release:test-gates
corepack pnpm indexer:test-target
corepack pnpm indexer:test-schema
corepack pnpm staging:test-public-manifest
corepack pnpm staging:test-v2-review
```

Kriteria:

- body limit, timeout, proxy identity, token bucket, dan cache coalescing fail-closed;
- route planner melakukan ranking/dedup/bounded search dan mode v4/v3/mixed dengan benar;
- local signer ditolak pada mode production, remote signature diverifikasi;
- staging harus chain `46630`, dual-mode flag cocok, dan wallet allowlist non-kosong;
- short timelock, incomplete evidence, hook kosong, role collision, dan operasi tak sehat memblokir promotion;
- manifest staging tetap `nonRelease=true`, `executionReady=false`, official manifest tetap Router v1;
- V2 review tetap `admissionDecision="withhold"` dan `adapterDeploymentAuthorized=false`.

## 8. Audit dependency, build, dan coverage

```bash
corepack pnpm audit:prod
corepack pnpm audit:security
corepack pnpm contracts:coverage
corepack pnpm contracts:coverage:test-hook
corepack pnpm build
corepack pnpm audit:bundle
```

Checkpoint coverage saat ini:

- statements: **89,12%**;
- branches: **56,49%**;
- functions: **89,47%**;
- lines: **88,79%**;
- Router statements: **97,56%**;
- dormant V2 adapter statements: **96,55%**.

Chain-`46630` test-hook coverage dijalankan terpisah karena constructor sengaja menolak default chain `31337`:

- statements: **100%**;
- branches: **60,64%**;
- functions: **100%**;
- lines: **97,89%**.

`contracts:coverage` mengecualikan hanya test-hook dan adversarial mock yang masuk gate fork terpisah. `contracts:coverage:test-hook` membersihkan artifact sebelum instrumentasi, menjalankan exact latest-state hook suite, lalu mengembalikan dan mengekspor artifact production. Kedua command wajib dan sekarang berjalan sebagai gate CI terpisah dengan artifact report masing-masing; pemisahan scope tidak boleh digunakan untuk menyembunyikan penurunan coverage.

Audit terbaru: production dependencies bersih. Full audit memiliki satu exception low-severity development-only `GHSA-848j-6mx2-7j84`, tanpa patched upstream release, dengan expiry 15 Januari 2027.

## 9. Slither dari artifact bersih

Artifact incremental pernah menghasilkan temuan stale. Gunakan urutan berikut untuk scan authoritative:

```bash
python -m pip install slither-analyzer==0.11.3
corepack pnpm exec hardhat clean
corepack pnpm contracts:export
slither . \
  --hardhat-ignore-compile \
  --hardhat-artifacts-directory contracts/artifacts \
  --hardhat-cache-directory .hardhat-cache \
  --exclude-dependencies \
  --filter-paths 'contracts/src/mocks|contracts/test'
```

Checkpoint saat ini: **82 contracts, 100 detectors, 0 results**. Fixture hook tetap dipindai; finding struktural hanya boleh diberi suppression sempit dengan alasan pada baris terkait. Jangan mengecualikan seluruh `contracts/src/test` atau membuat suppression global.

## 10. Latest-state fork integrations

Gunakan RPC chain `46630` yang tersedia secara lokal; jangan menaruh URL berkredensial di command history atau chat.

```bash
unset FORK_BLOCK_NUMBER
corepack pnpm contracts:test:fork
```

Kriteria saat ini: **6 passing**:

1. v4 native→token dan token→native;
2. Synthra v3 native→TSLA dan Permit2-backed TSLA→native;
3. dormant V2 adapter native→TSLA terhadap pair yang source-exact dan codehash-pinned;
4. isolated chain-46630 test-hook settlement dua arah;
5. test-hook authorization, key, liquidity, exact-output, dan drift boundaries; dan
6. callback replay, nested reentrancy, wrong currency, partial payment, serta short-output containment.

Catatan: public RPC tidak menyediakan old archival block, sehingga suite menggunakan latest state. V2 fork success hanya membuktikan compatibility, bukan provenance, liquidity, activity, atau admission.

Read-only compatibility terhadap candidate hook chain `4663` dijalankan terpisah:

```bash
corepack pnpm contracts:test:mainnet-hook
corepack pnpm contracts:compare:mainnet-hook
```

Test mewajibkan `HookSwap`, nonzero hook pada `RouteStepSettled`, dan exact runtime codehash. Provider sengaja diberi identitas `UNAPPROVED_MAINNET_HOOK_COMPATIBILITY`; hasilnya tidak mengizinkan admission atau deployment mainnet. Tabel same-state output/fee/rebate/gas tersedia di `docs/TRADE_COMPARISON.md`.

Lanjutkan dengan rehearsal deployment pada fork lokal:

```bash
corepack pnpm contracts:rehearse:testnet
```

Kriteria: Router v2, admitted v4/v3 adapters, provider IDs, dependency/codehash checks, dan post-deploy reads lulus; rehearsal manifest tetap `executionReady=false` dan bukan deployment resmi.

### D4 isolated non-official test-hook package

D4 memiliki rehearsal terpisah karena tidak boleh masuk deployment manifest biasa:

```bash
corepack pnpm contracts:plan:test-hook
corepack pnpm contracts:rehearse:test-hook
```

Rehearsal harus mereproduksi exact CREATE2/init/runtime identity, PoolKey/dependency checks, satu bounded WETH→TSLA settlement, fee/token-balance cleanup, Router pause, dan ownership renunciation pada Router/adapter terisolasi. Caught-failure path setelah Router tersedia juga harus berakhir `isolatedStackSecure: true` atau secara eksplisit meminta manual recovery; ia tidak boleh membuat valid evidence file.

Live operation hanya manual dari clean committed checkout, memerlukan acknowledgement exact dan locally configured testnet-only key, serta dapat membuat 12–14 irreversible public testnet transactions. `staging:verify-test-hook` kemudian recompiles exact evidence commit dan memverifikasi setiap receipt/calldata/event, deployment source, current paused/ownerless/token-clean state, existing-staging non-admission, serta unchanged manifests. Jangan menjalankan live command dari dokumentasi ringkas; ikuti [`TEST_HOOK_EVIDENCE.md`](TEST_HOOK_EVIDENCE.md) seluruhnya. Sampai verifier live lulus, status D4 tetap pending dan rehearsal hash tidak boleh dipublikasikan sebagai evidence.

## 11. Bukti staging yang sudah ada — read-only

Pengujian ini tidak mengirim transaksi baru:

```bash
corepack pnpm staging:test-public-manifest
corepack pnpm staging:verify-evidence
corepack pnpm staging:test-v2-review
```

`staging:verify-evidence` harus membaca ulang chain canonical dan membuktikan:

- direct v4;
- Synthra v3;
- token-to-token multi-hop;
- cross-venue `UNISWAP_V4_DIRECT → SYNTHRA_V3`;
- Permit2 signature transfer;
- referral accrual;
- treasury claim;
- referral claim.

Status yang benar sekarang adalah **8 dari 9 skenario**, karena mobile WalletConnect masih pending. Jangan mengubah status menjadi 9/9 dari fixture atau konfigurasi saja.

## 12. Fresh staging transaction tests — side-effecting

Jalankan hanya jika akun testnet lokal masih tersedia dan terdanai. Source secret dari file ignored tanpa mencetaknya:

```bash
set -a
. .staging/keys.env
set +a
```

### 12.1 Bootstrap direct-v4 E2E

```bash
PERM_STAGING_URL=https://your-staging-host.example \
corepack pnpm staging:run-e2e
```

Kriteria:

- quote berasal dari chain `46630` dan account ada dalam allowlist;
- route hanya provider yang diizinkan, tanpa hook;
- exact signed call berhasil disimulasikan dan disubmit;
- canonical `SwapSettled` dan `RouteStepSettled` ditemukan;
- output lokal ditulis ke ignored `.staging/e2e.json`;
- manifest tetap `executionReady=false`.

### 12.2 v3, multi-hop, cross-venue, dan Permit2

```bash
PERM_STAGING_URL=https://your-staging-host.example \
STAGING_EVIDENCE_SCENARIOS=v3,multiHop,crossVenue,permit2 \
corepack pnpm staging:run-evidence
```

Kriteria:

- v3 menggunakan deployed Synthra adapter;
- multi-hop memiliki minimal dua langkah kontinu;
- cross-venue memiliki tepat dua venue yang mencakup direct v4 dan Synthra v3;
- Permit2 calldata memuat signature transfer dan deadline;
- hasil lokal masuk `.staging/e2e-suite.json`.

### 12.3 Referral dan pull claims

Ini mengubah registry referral staging dan mengirim transaksi testnet; guard eksplisit wajib:

```bash
PERM_STAGING_URL=https://your-staging-host.example \
CONFIRM_STAGING_ADMIN_EVIDENCE=I_UNDERSTAND_TESTNET_ONLY \
STAGING_EVIDENCE_SCENARIOS=referral,treasuryClaim,referralClaim \
corepack pnpm staging:run-evidence
```

Kriteria:

- account berbeda dari referrer;
- referral dan treasury accrual cocok dengan fee split;
- masing-masing beneficiary mengirim claim-nya sendiri;
- claim event, recipient, token, dan amount cocok.

Setelah fresh transactions, salin hanya hash/receipt ID publik yang telah direview ke manifest publik, lalu jalankan kembali:

```bash
corepack pnpm staging:test-public-manifest
corepack pnpm staging:verify-evidence
```

Jangan menjalankan skenario `v2`, jangan set `PERM_STAGING_ALLOW_REVIEWED_V2=1`, dan jangan deploy/register adapter V2 selama admission masih withheld.

## 13. WalletConnect mobile — manual dan independen

Ini satu-satunya skenario staging yang belum dapat dibuktikan otomatis tanpa manusia/perangkat eksternal.

1. Buat template ignored:

   ```bash
   corepack pnpm staging:prepare-walletconnect
   ```

2. Di UI staging, pair wallet mobile melalui Reown QR.
3. Gunakan account testnet yang berbeda dari owner, treasury, guardian, quote signer, referrer, dan QA attester.
4. Submit small Router-v2 staging swap dan tunggu canonical receipt.
5. Isi `.staging/walletconnect.json` dengan public metadata, transaction hash, receipt ID, wallet/device, waktu, attester, dan **hanya hash satu arah session topic**. Jangan simpan field `sessionTopic` mentah.
6. Jalankan lagi:

   ```bash
   corepack pnpm staging:prepare-walletconnect
   ```

   Command mencetak exact message yang harus ditandatangani.
7. Independent QA signer melakukan personal-sign terhadap exact message tersebut.
8. Simpan hanya public signer address dan signature ke file ignored.
9. Set public trust root secara lokal dan verifikasi:

   ```bash
   export STAGING_WALLETCONNECT_EVIDENCE=.staging/walletconnect.json
   export STAGING_WALLETCONNECT_QA_SIGNERS='0x...public-QA-address...'
   corepack pnpm staging:verify-walletconnect
   ```

Kriteria:

- transaksi canonical, successful, fresh, dan memanggil staging Router;
- sender sama dengan account mobile;
- receipt ID cocok dengan `SwapSettled`;
- attestation signer berada dalam trust root dan independen dari semua role;
- signature pulih ke signer yang tepat;
- attestation time dekat dengan block time;
- raw session topic tidak pernah tersimpan.

Fixture sintetis hanya boleh digunakan untuk regression test verifier dan tidak boleh diterbitkan sebagai mobile proof.

## 14. UI dan hosted health smoke test

### 14.1 Local production build

Terminal 1:

```bash
corepack pnpm build
corepack pnpm start
```

Terminal 2:

```bash
for route in / /trade /routes /rebate /proofs /docs /setup; do
  curl -fsS -o /dev/null "http://localhost:3000$route" || exit 1
done
```

Periksa manual desktop dan lebar 390 px:

- tidak ada horizontal overflow;
- token picker dan wallet dialog memiliki label, focus containment, autofocus, dan Escape close;
- live quote/candidate tampil;
- WalletConnect disabled dengan alasan eksplisit bila project ID tidak ada;
- V2 tidak tampil ketika flags/admission tidak tersedia;
- execution button tidak mengklaim release readiness.

### 14.2 Hosted non-release boundary

```bash
curl -fsS 'https://perm-iota.vercel.app/api/health?requireStaging=1'
curl -sS -o /tmp/perm-release-health.json -w '%{http_code}\n' \
  'https://perm-iota.vercel.app/api/health?requireExecution=1'
cat /tmp/perm-release-health.json
```

Kriteria:

- staging health: HTTP 200, `status="staging-ready-non-release"`, `stagingReady=true`;
- release health: HTTP 503, `executionReady=false`.

HTTP 200 pada staging health tidak boleh disebut production/release ready.

## 15. PostgreSQL dan indexer

### 15.1 Schema tanpa server eksternal

```bash
corepack pnpm indexer:test-schema
```

Kriteria: migration idempotent, shared token bucket, 78-digit numerics, deferred evidence FK, state upsert, dan cascade lulus.

### 15.2 PostgreSQL nyata yang disposable

Command berikut destruktif terhadap database test; gunakan database khusus yang boleh dihapus:

```bash
PGSSLMODE=disable \
TEST_DATABASE_URL='postgres://local-test-user:local-test-password@127.0.0.1:5432/perm_test' \
corepack pnpm indexer:test-postgres
```

Jangan gunakan Neon production/staging database untuk test destruktif ini.

### 15.3 Hosted indexer one-shot

Set credential hanya di shell/provider secret store, lalu jalankan:

```bash
export PERM_INDEXER_MODE=allowlisted-testnet-staging
export PERM_INDEXER_CHAIN_ID=46630
export PERM_INDEXER_ROUTER_ADDRESS='0x...staging-router...'
export PERM_INDEXER_ROUTER_VERSION=2
export PERM_INDEXER_DEPLOYMENT_BLOCK='...'
export PERM_INDEXER_CONFIRM_NON_RELEASE=1
corepack pnpm indexer:run
```

Kriteria:

- canonical cursor hash tersimpan;
- lag sesuai confirmation depth;
- staging settlements masuk database;
- `/api/history` melaporkan source PostgreSQL dan mengembalikan settlement yang diketahui.

Biarkan schedule disabled sampai operator memang memutuskan mengaktifkannya.

## 16. Monitor, RPC failover, dan alerting

Alerting saat ini sengaja deferred, sehingga `PERM_MONITOR_ENABLED=0` harus tetap dipertahankan. Regression logic tetap diuji oleh `corepack pnpm check`.

Jika dan hanya jika alerting tidak lagi deferred, siapkan dua RPC berbeda, PostgreSQL, hosted staging URL, dan webhook asli di secret store. Kemudian kirim satu test alert secara eksplisit:

```bash
export CONFIRM_ALERT_WEBHOOK_TEST=SEND_TEST_ALERT
corepack pnpm monitor:staging
```

Kriteria:

- kedua RPC chain `46630`, fresh, dan dalam bounded block distance;
- cursor database canonical dan fresh;
- `requireStaging=1` lulus, `requireExecution=1` tetap gagal;
- test webhook benar-benar diterima oleh on-call destination.

Jangan mengaktifkan GitHub schedule hanya dari hasil lokal; schedule memerlukan keputusan operator.

## 17. Pool discovery

Fresh manual scan bersifat write-to-registry:

```bash
RH_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com \
corepack pnpm pools:discover

git diff -- deployments/v4-pools.json
git diff --check
```

Kriteria checkpoint saat ini:

- finalized through block `155962684` atau lebih baru;
- minimal **1.395** direct eligible pools;
- hooked pools tidak otomatis admitted;
- setiap penambahan direview sebelum commit.

Jika chain bertambah, count/block dapat naik secara sah. Jangan membuang hasil baru hanya agar cocok dengan angka lama. Biarkan `PERM_POOL_DISCOVERY_ENABLED=0` sampai schedule diotorisasi.

## 18. Review V2 venue

Regression read-only:

```bash
corepack pnpm staging:test-v2-review
```

Fresh chain/source review yang dapat memperbarui JSON:

```bash
RH_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com \
corepack pnpm staging:review-v2

git diff -- deployments/robinhood-testnet.v2-venue-review.json
git diff --check
```

Kriteria saat ini:

- 11/11 published files exact upstream match;
- factory/pair codehash cocok;
- balances sama dengan reserves;
- provenance, recent independent activity, dan meaningful liquidity **belum** established;
- `admissionDecision="withhold"`;
- `adapterDeploymentAuthorized=false`;
- staging manifest tidak memiliki deployed V2 adapter/provider.

Perm-generated traffic tidak boleh dipakai untuk memenuhi independent-activity gate.

## 19. Aggregator Hook

Saat ini tidak ada hook chain-46630 yang lolos review. Pengujian yang benar sekarang adalah memastikan fail-closed:

```bash
corepack pnpm release:test-gates
corepack pnpm staging:test-public-manifest
```

Kriteria:

- reserved hook provider disabled;
- reviewed hooks list kosong;
- normal direct-v4 pools tidak dilabeli Aggregator Hook;
- candidate tanpa real reviewed hook tidak dapat dipromosikan.

`release:verify-hooks` baru boleh diharapkan lulus setelah ada hook nyata dengan source/audit, permissions, exact PoolKey, hook data, runtime codehash, bounded quote probe, dan canonical Router settlement.

## 20. Candidate release gates — belum untuk staging sekarang

Langkah berikut adalah acceptance tests untuk candidate yang memakai role/custody/operasi release nyata, bukan untuk mempromosikan staging burner:

```bash
corepack pnpm deployments:verify-candidate
corepack pnpm release:probe-signer
corepack pnpm release:verify-e2e
corepack pnpm release:verify-hooks
corepack pnpm release:verify-operations
corepack pnpm release:prepare-assurance
corepack pnpm release:verify-assurance
```

Semua harus lulus terhadap commit dan Router candidate yang sama. Diperlukan:

- role multisig terpisah dan minimum 48-hour timelock;
- exact source verification;
- non-exportable remote KMS/HSM signer;
- direct/fallback RPC, current indexer, shared limiter, dan alert delivery;
- real WalletConnect evidence;
- real reviewed Aggregator Hook evidence;
- independent audit, incident drill, funded bounty;
- empat approval roles yang berbeda.

Promotion adalah tindakan terpisah dan tidak boleh dijalankan sekarang:

```text
corepack pnpm deployments:promote
```

Jalankan hanya setelah setiap gate di atas benar-benar lulus dan dua confirmation variables cocok dengan exact candidate Router.

## 21. Final acceptance sequence

Urutan aman untuk acceptance lengkap tanpa membuat release claim:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm audit:security
corepack pnpm check
corepack pnpm contracts:coverage
unset FORK_BLOCK_NUMBER
corepack pnpm contracts:test:fork
corepack pnpm contracts:rehearse:testnet
corepack pnpm staging:test-public-manifest
corepack pnpm staging:verify-evidence
corepack pnpm staging:test-v2-review
git diff --check
git status --short
```

Tambahkan Slither, disposable PostgreSQL test, fresh pool discovery, fresh staging transactions, dan WalletConnect manual sesuai kebutuhan/batas masing-masing bagian.

Kondisi selesai yang benar saat ini:

- local/fork/security gates hijau;
- staging canonical evidence 8/9, WalletConnect masih pending sampai manusia menyelesaikannya;
- official manifest tetap Router v1;
- Router v2 tetap `executionReady=false`;
- V2 dan Aggregator Hook tetap withheld;
- monitor/alert schedules tetap disabled;
- tidak ada secret atau ignored evidence yang masuk Git.

## 22. `git add` per fitur

> **Penting:** seluruh fitur di bawah sudah committed pada branch saat ini, sehingga command `git add` akan menghasilkan no-op pada working tree yang bersih. Daftar ini adalah staging recipe untuk perubahan baru, branch rekonstruksi, atau sebelum commit dilakukan. Jangan menjalankan `reset --hard` atau menulis ulang history yang sudah dipublikasikan. Jika memang ingin memecah history yang sudah ada, buat backup branch dan review rencana rewrite terlebih dahulu.

Beberapa file mengandung banyak fitur sekaligus. Untuk file seperti `PermRouter.sol`, `PermRouter.test.cjs`, quote route, route planner, manifest, dan verifier staging, gunakan `git add -p`; jangan stage seluruh file ke commit yang salah.

Kontrol interactive staging:

- `y`: stage hunk;
- `n`: jangan stage hunk;
- `s`: pecah hunk;
- `e`: edit patch secara manual;
- `q`: berhenti.

Sebelum setiap commit:

```bash
git restore --staged .
git status --short
# Jalankan blok git add untuk satu fitur.
git diff --cached --check
git diff --cached --stat
git diff --cached
```

Pastikan `.staging/`, private key, credential URL, webhook, session topic, dan ignored deployment manifest tidak pernah muncul dalam `git diff --cached`.

### 22.1 Signed multi-venue Router foundation

File khusus Router dapat di-stage langsung; file yang juga memuat Permit2, fee, atau route-step behavior harus dipilih per hunk:

```bash
git add \
  contracts/src/interfaces/IPermAdapter.sol \
  contracts/src/mocks/MockAdapter.sol \
  contracts/src/mocks/MockERC20.sol \
  contracts/src/mocks/MockMutableAdapter.sol \
  contracts/src/mocks/ReentrantAdapter.sol \
  contracts/src/mocks/RejectEther.sol

git add -p \
  contracts/src/PermRouter.sol \
  contracts/test/PermRouter.test.cjs \
  contracts/test/PermRouterInvariant.test.cjs \
  contracts/scripts/deploy.cjs \
  contracts/scripts/export-artifacts.cjs \
  lib/web3/abis.ts \
  lib/web3/quote.ts

# Stage artifact hanya setelah diekspor dari exact source state commit ini.
git add lib/web3/artifacts/PermRouter.json

git diff --cached --check
corepack pnpm exec hardhat test \
  contracts/test/PermRouter.test.cjs \
  contracts/test/PermRouterInvariant.test.cjs
git commit -m "feat(router): add signed multi-venue exact-input settlement"
```

Jangan ikut memilih hunk khusus Permit2, referral/claim, explicit cross-venue, atau V2 pada commit Router foundation.

### 22.2 Direct no-hook Uniswap v4 routing

```bash
git add \
  contracts/src/adapters/PermV4Adapter.sol \
  contracts/test/PermV4Adapter.test.cjs \
  contracts/test/PermV4Fork.test.cjs

git add -p \
  contracts/scripts/deploy.cjs \
  contracts/scripts/export-artifacts.cjs \
  app/api/quote/route.ts \
  lib/server/route-planner.ts \
  scripts/test-route-planner.ts \
  lib/web3/abis.ts \
  lib/web3/config.ts \
  lib/web3/quote.ts \
  components/RouteExplorer.tsx \
  components/TradeApp.tsx

# Generated artifact harus berasal dari source state v4 commit ini.
git add lib/web3/artifacts/PermV4Adapter.json

git diff --cached --check
corepack pnpm exec hardhat test contracts/test/PermV4Adapter.test.cjs
git commit -m "feat(v4): add direct no-hook Uniswap v4 routing"
```

Jangan masukkan `deployments/v4-pools.json` di sini jika registry ingin dibuat sebagai commit operasi terpisah.

### 22.3 Synthra v3 routing dan settlement

```bash
git add \
  contracts/src/adapters/PermV3Adapter.sol \
  contracts/src/mocks/MockSwapRouter02.sol \
  contracts/src/mocks/MockWETH.sol \
  contracts/test/PermV3Adapter.test.cjs

git add -p \
  contracts/test/PermV3Fork.test.cjs \
  contracts/scripts/deploy.cjs \
  contracts/scripts/export-artifacts.cjs \
  app/api/quote/route.ts \
  lib/server/route-planner.ts \
  scripts/test-route-planner.ts \
  lib/web3/abis.ts \
  lib/web3/config.ts \
  lib/web3/quote.ts \
  components/RouteExplorer.tsx \
  components/TradeApp.tsx

git add lib/web3/artifacts/PermV3Adapter.json

git diff --cached --check
corepack pnpm exec hardhat test contracts/test/PermV3Adapter.test.cjs
git commit -m "feat(v3): add Synthra v3 routing and settlement"
```

Jika satu test fork menguji v3 sekaligus Permit2, stage test tersebut pada commit Permit2 atau pecah test secara eksplisit; jangan menduplikasi file yang sama tanpa review.

### 22.4 Token-to-token multi-hop planning

Hampir seluruh file multi-hop berbagi concern dengan Router atau venue lain, jadi gunakan interactive staging:

```bash
git add -p \
  contracts/src/PermRouter.sol \
  contracts/test/PermRouter.test.cjs \
  app/api/quote/route.ts \
  lib/server/route-planner.ts \
  scripts/test-route-planner.ts \
  lib/web3/quote.ts \
  components/RouteExplorer.tsx \
  components/TradeApp.tsx

git diff --cached --check
corepack pnpm exec hardhat test contracts/test/PermRouter.test.cjs
corepack pnpm server:test
git commit -m "feat(routing): add token-to-token multi-hop planning"
```

Pilih hanya hunk route continuity, intermediary search, bounded path length, ranking/deduplication, dan multi-step display.

### 22.5 Explicit v4-to-v3 cross-venue execution

```bash
git add -p \
  contracts/src/PermRouter.sol \
  contracts/test/PermRouter.test.cjs \
  app/api/quote/route.ts \
  lib/server/route-planner.ts \
  scripts/test-route-planner.ts \
  lib/web3/quote.ts \
  components/RouteExplorer.tsx \
  components/TradeApp.tsx \
  scripts/run-staging-evidence.ts \
  scripts/verify-staging-evidence.cjs \
  scripts/test-public-staging-manifest.mjs \
  deployments/robinhood-testnet.v2-staging.json \
  docs/ALLOWLISTED_STAGING.md

git diff --cached --check
corepack pnpm exec hardhat test contracts/test/PermRouter.test.cjs
corepack pnpm server:test
corepack pnpm staging:test-public-manifest
corepack pnpm staging:verify-evidence
git commit -m "feat(routing): add explicit v4-to-v3 cross-venue execution"
```

Untuk manifest dan verifier, pilih hanya hunk `crossVenue` serta validasi dua provider/adapter. Jangan ikut stage V2 atau WalletConnect hunks.

### 22.6 Permit2 signature-transfer settlement

```bash
git add \
  contracts/src/interfaces/IPermit2.sol \
  contracts/src/mocks/MockPermit2.sol

git add -p \
  contracts/src/PermRouter.sol \
  contracts/test/PermRouter.test.cjs \
  contracts/test/PermV3Fork.test.cjs \
  contracts/scripts/deploy.cjs \
  app/api/quote/route.ts \
  lib/web3/abis.ts \
  lib/web3/config.ts \
  lib/web3/quote.ts \
  scripts/run-staging-evidence.ts \
  scripts/verify-staging-evidence.cjs \
  scripts/test-public-staging-manifest.mjs \
  deployments/robinhood-testnet.v2-staging.json \
  docs/ALLOWLISTED_STAGING.md

git diff --cached --check
corepack pnpm exec hardhat test contracts/test/PermRouter.test.cjs
corepack pnpm staging:test-public-manifest
corepack pnpm staging:verify-evidence
git commit -m "feat(permit2): add signature-transfer input settlement"
```

Pilih hanya Permit2 address/domain, permit deadline, signature-transfer calldata, exact allowance behavior, dan bukti Permit2.

### 22.7 Fee rebate, referral, dan pull-payment accounting

```bash
git add \
  contracts/src/mocks/MockFeeOnTransferERC20.sol \
  app/rebate/page.tsx \
  components/RebateCalculator.tsx

git add -p \
  contracts/src/PermRouter.sol \
  contracts/test/PermRouter.test.cjs \
  contracts/test/PermRouterInvariant.test.cjs \
  app/api/history/route.ts \
  app/api/receipts/route.ts \
  lib/web3/abis.ts \
  lib/web3/quote.ts \
  scripts/run-staging-evidence.ts \
  scripts/verify-staging-evidence.cjs \
  scripts/test-public-staging-manifest.mjs \
  deployments/robinhood-testnet.v2-staging.json \
  docs/ALLOWLISTED_STAGING.md

git diff --cached --check
corepack pnpm exec hardhat test \
  contracts/test/PermRouter.test.cjs \
  contracts/test/PermRouterInvariant.test.cjs
corepack pnpm staging:test-public-manifest
corepack pnpm staging:verify-evidence
git commit -m "feat(fees): add rebate referral and pull-payment accounting"
```

Pilih hanya gross fee, rebate, net fee, referral split, protected reserves, accrual, claim, dan fee-on-transfer rejection hunks.

### 22.8 Independent WalletConnect mobile-session attestation verifier

```bash
git add \
  scripts/lib/wallet-attestation.cjs \
  scripts/test-wallet-attestation.mjs \
  scripts/prepare-staging-walletconnect.cjs

git add -p \
  scripts/verify-staging-evidence.cjs \
  package.json \
  .env.example \
  docs/ALLOWLISTED_STAGING.md \
  docs/GAP_20NOV_CLOSURE.md

git diff --cached --check
node scripts/test-wallet-attestation.mjs
corepack pnpm staging:test-public-manifest
corepack pnpm lint
git commit -m "feat(walletconnect): add independent mobile-session attestation verifier"
```

Jika commit juga memperkenalkan UI pairing, review dan stage hunk WalletConnect saja dari:

```bash
git add -p components/Web3Provider.tsx components/TradeApp.tsx
```

Jangan stage `.staging/walletconnect.json`, project credential, raw session topic, atau private QA material.

### 22.9 Bind V2 adapter caller dan recipient ke immutable Router

Untuk hardening recipient restriction yang spesifik, file set-nya sempit:

```bash
git add \
  contracts/src/adapters/PermV2Adapter.sol \
  contracts/test/PermV2Adapter.test.cjs

# Export artifact sesudah source final untuk commit ini.
corepack pnpm contracts:export
git add lib/web3/artifacts/PermV2Adapter.json

git diff --cached --check
corepack pnpm exec hardhat test \
  contracts/test/PermV2Adapter.test.cjs \
  contracts/test/ArtifactIntegrity.test.cjs
git commit -m "security(v2): bind adapter caller and recipient to the immutable router"
```

Jika dormant adapter baru juga diperkenalkan dalam rangkaian perubahan yang sama, buat commit sebelumnya yang terpisah untuk source/mocks/fork/review. Commit security ini hanya memuat binding caller/recipient dan regression-nya. Tetap jangan deploy atau register V2.

### 22.10 Refresh Robinhood v4 direct-pool registry

```bash
git add deployments/v4-pools.json

# Dokumentasi angka block/count hanya jika ikut diperbarui.
git add -p docs/QA.md docs/DEPLOYMENT.md docs/GAP_20NOV_CLOSURE.md

git diff --cached --check
corepack pnpm staging:test-public-manifest
git commit -m "chore(pools): refresh Robinhood v4 direct-pool registry"
```

Sebelum staging, review diff registry untuk memastikan setiap entry eligible, finalized, dan zero-hook atau hook-nya benar-benar telah direview. Jangan stage hasil scanner secara buta.

### 22.11 Menangani generated artifacts saat perubahan masih tercampur

Artifact JSON tidak aman di-stage dari working tree yang masih berisi fitur lain. Untuk membangun artifact hanya dari staged source:

```bash
# Setelah source hunks fitur saat ini sudah staged:
git stash push --keep-index --include-untracked -m "wip-unstaged-feature-split"
corepack pnpm contracts:export
# Stage hanya artifact yang relevan untuk fitur saat ini.
git add lib/web3/artifacts/<ArtifactYangRelevan>.json
git diff --cached --check
# Jalankan targeted tests, lalu commit.
git commit -m "<pesan commit fitur>"
git stash pop
```

Periksa `git status` dan conflict setelah `stash pop`. Jangan gunakan prosedur ini tanpa backup jika working tree berisi pekerjaan yang belum tersimpan.

### 22.12 Final verification setelah seluruh commit granular

```bash
corepack pnpm check
unset FORK_BLOCK_NUMBER
corepack pnpm contracts:test:fork
corepack pnpm staging:test-public-manifest
corepack pnpm staging:verify-evidence
corepack pnpm staging:test-v2-review
git diff --check
git status --short
git log --oneline -12
```

Kriteria final tetap sama: official Router v1, Router v2 non-release `executionReady=false`, V2/Hook withheld, WalletConnect tidak diklaim lulus sebelum proof manusia, dan tidak ada secret/ignored evidence di commit mana pun.
