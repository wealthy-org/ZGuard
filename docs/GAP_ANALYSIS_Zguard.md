# GAP_ANALYSIS_Zguard: Gap Analysis & Kepatuhan Brief

> **Repo:** `wealthy-org/ZGuard` @ `fd0dfa3` · **Tanggal:** 2026-11-25 · **Clone:** `BRAINSTROMING/zguard/repo`
> **Live:** https://zguard-delta.vercel.app · **Acuan:** `BRIEF.md` (dev-brief-zguard, 24 Nov 2026) + standar umum aplikasi DeFi
> **Scope:** seluruh monorepo (sdk, mcp, api, web, zk). Tidak ada pengecualian dari user.

**Cara baca dokumen ini:** setiap temuan besar memakai pola
> **Masalahnya apa** → **Kenapa penting** → **Contoh kejadian** → **Cara memperbaiki** → **Bedanya setelah diperbaiki**

Dokumen ini dipakai anak dev sebagai daftar kerja. Bagian F adalah urutan pengerjaannya.

> **Status putaran penutupan gap (2026-11-25, anak dev):** semua gap yang bisa ditutup lewat kode sudah dikerjakan dan di-commit di `main` lokal (26 commit di atas `fd0dfa3`, belum di-push). Gap yang tersisa butuh infrastruktur atau akses dari luar repo: deploy Vercel, prover SP1, deploy verifier, wallet asli, dan repo Perm/terminal. Ringkasan lengkap ada di **Bagian M** di akhir dokumen. Setiap temuan di bawah diberi baris **Status** dan semua checklist diberi `Bukti:`.

---

## Kamus Istilah
| Istilah | Artinya dalam bahasa sederhana |
|---|---|
| Quote-match | Mengecek bahwa transaksi yang mau ditandatangani sama dengan tagihan (quote): penerima, jumlah, aset, chain |
| Verdict | Keputusan akhir: `allow` (boleh), `deny` (tolak), `abstain` (tidak bisa memutuskan, dianggap tolak) |
| Fail-closed | Kalau ada yang rusak, hasilnya menolak, bukan mengizinkan |
| Required / advisory | Cek wajib lulus / cek yang hanya memberi peringatan |
| x402 | Cara bayar per panggilan API lewat HTTP 402 |
| USDG | Stablecoin di Robinhood Chain (RHC), dipakai untuk bayar API |
| Groth16 / Halo2-KZG | Dua jenis bukti zero-knowledge (zk): bukti bahwa sebuah hitungan benar tanpa membuka isinya |
| SP1 | zkVM: mesin yang menjalankan kode Rust lalu menghasilkan bukti zk |
| Precompile BN254 | Fungsi matematika bawaan chain (alamat 0x06/07/08) untuk memeriksa bukti zk |
| Verifier (kontrak) | Smart contract yang memeriksa bukti zk di chain |
| Sybil | Satu orang membuat banyak akun palsu untuk menyedot jatah gratis |
| PoC | Bukti kerja: kode kecil yang membuktikan bug benar-benar ada |

## Bagaimana analisis ini dibuat (dan kenapa bisa dipercaya)
| Yang dilakukan | Hasil | Kenapa ini penting |
|---|---|---|
| Baca brief penuh (739 baris) dan README repo | Selesai | README mengklaim hampir semua butir ✅; brief dipakai sebagai pembanding, bukan README |
| Baca kode: sdk (decision, signer, client), api (app, x402, config), zk (index, verifier .sol, guest Rust, circuit Rust), web (next.config, views) | Selesai | Temuan berasal dari kode |
| `pnpm install` + build sdk/zk/mcp + `pnpm -r typecheck` | Install OK, build OK, typecheck 5/5 proyek lulus | Kode kompilasi bersih |
| `pnpm test` (api): 11 test | **5 lulus, 6 gagal** dalam 404 dtk. Gagal: file `acceptance.test.ts` (gagal di 0,6 dtk, kemungkinan karena `@zguard/mcp` belum di-build oleh script `test`), §9.3, §9.2, §9.5 x2, §9.10 (testnet) | Klaim README "20/20 passing" tidak terbukti dari mesin ini. **Catatan jujur:** RPC RHC tidak bisa dijangkau dari mesin audit (`SSL certificate problem: self signed certificate`), jadi kegagalan test live bisa karena jaringan, bukan murni bug. Setelah mcp di-build, acceptance belum selesai dalam 150 dtk, tidak disimpulkan |
| Probe live app (`curl`) | `/` = HTML 200. `/health`, `/v1/*`, `POST /v1/guard` = **HTTP 308 berputar ke dirinya sendiri** (5 redirect, tidak pernah selesai) | API tidak hidup di URL publik |
| Cek onchain (`eth_getCode`, precompile 0x08, USDG) | **Tidak terverifikasi**: RPC tidak terjangkau (SSL). Dibaca dari README saja | Tidak ada status "verified" yang diklaim di sini |
| Explorer / verifikasi source kontrak | Tidak dilakukan: tidak ada alamat verifier yang ter-deploy di repo (`ZGUARD_ZK_VERIFIER_ADDRESS=""`) | Tidak ada yang bisa dicek |
| PoC test | Tidak ditulis. Temuan di bawah berstatus **dari kode** (code-only), kecuali yang tertulis lain | Anak dev diminta menulis PoC sebagai bagian perbaikan (lihat F) |

Perintah mengulang: `pnpm install && pnpm --filter @zguard/sdk build && pnpm --filter @zguard/zk build && pnpm --filter @zguard/mcp build && pnpm -r typecheck && pnpm test`

## Ringkasan
**Yang sudah bagus:** struktur monorepo rapi dan typecheck bersih. Aturan keputusan (`allow/deny/abstain`) dan wrapper signer mengikuti brief: abstain ditolak, hash payload dicocokkan, expiry dicek, API mati menghasilkan `abstain`. Replay nonce x402 dicek. Tidak ada kata "safe". Tidak ada `.env` rahasia di git.

**Yang belum ada (paling besar):** (1) lapisan zk yang sesungguhnya (bukti Groth16/Halo2 asli dan kontrak verifier ter-deploy); (2) API hosted yang hidup di URL publik; (3) bukti mainnet 4663 dan tx bukti; (4) integrasi nyata ke Perm dan terminal; (5) CI, audit, monitoring.

**Yang perlu diperbaiki (paling mendesak):** "bukti zk" saat ini tidak membuktikan apa-apa (tautologi matematika); klien bisa melewati cek `required`; endpoint `/v1/register` bisa dikuras gratis; README mengklaim ✅ untuk hal yang belum ada.

| # | Temuan singkat | Seberapa serius | Terbukti? | Status 2026-11-25 |
|---|---|---|---|---|
| C1 | Bukti zk Path B tidak membuktikan verdict (selalu lolos) | 🔴 Kritis | dari kode | ✅ diperbaiki (Path B dihapus, Foundry negatif) |
| C2 | SP1 dan Halo2 hanya kerangka; prover, verifier Halo2, dan deploy verifier tidak ada | 🔴 Tinggi | dari kode + env kosong | 🟡 scaffold jujur + crate aturan teruji; build/proof/deploy butuh infra |
| C3 | API live berputar 308, tidak bisa dipakai | 🔴 Tinggi | live (curl) | 🟡 kode diperbaiki (503 bukan loop); butuh env + redeploy Vercel |
| C4 | Klien bisa membatasi `checks` lalu dapat `allow` tanpa simulasi/token risk | 🔴 Tinggi | dari kode | ✅ diperbaiki (test gagal di kode lama, lulus di kode baru) |
| C5 | `/v1/register` tanpa rate limit, tiap akun dapat kredit gratis | 🟠 Sedang-tinggi | dari kode | ✅ diperbaiki |
| C6 | Test: 6 dari 11 gagal; tidak ada CI | 🟠 Sedang | dijalankan | ✅ diperbaiki (script + CI) |
| C7 | Default testnet 46630; brief minta mainnet 4663 | 🟠 Sedang | dari kode/README | ⏸ ditunda sesuai keputusan head dev (Bagian L) |
| C8 | Perm dan terminal hanya helper SDK, bukan integrasi default-on | 🟠 Sedang | dari kode | 🟡 **Perm: ✅ default-on fail-closed, lulus live di mainnet** (tx `0x88ee…49f2`); terminal: repo belum ada |
| C9 | README klaim ✅ melebihi bukti | 🟡 Proses | dibandingkan | ✅ diperbaiki (README + teks web) |
| D3 | Connect Wallet tidak terlihat setelah Open Console (UX) | 🟠 Sedang | screenshot + kode | ✅ diperbaiki di kode; uji wallet asli belum |

---

# BAGIAN A: Kepatuhan terhadap Brief
> **Kenapa bagian ini ada:** menjawab "apa yang dipesan vs apa yang dibangun".
Legenda: ✅ sesuai · 🟡 sebagian · ❌ belum ada · ⚠️ melanggar · ⚪ belum waktunya

## A1. Gambaran besar
| Isi brief | Status | Penjelasan singkat |
|---|---|---|
| Satu panggilan, tiga cek (quote, simulasi, token risk) | 🟡 | Kode ada di `/v1/guard`, tapi cek bisa dilewati (C4) dan live tidak jalan (C3) |
| Chain utama RHC 4663 | 🟡 | Kode mendukung keduanya, default testnet (C7) |
| SDK + CLI + MCP + API + wrapper signer | ✅ | Semua paket ada dan kompilasi |
| Billing x402 USDG | 🟡 | Kode settlement ada; belum terbukti dengan tx nyata dari mesin ini |
| Default-on di Perm dan terminal | 🟡 | Perm: gate default-on di `/trade` (C8, 2026-11-26). Terminal: menunggu repo |
| Lapisan zk Groth16 (wajib) + Halo2 (target) | ⚠️ | Klaim ✅ di README, kenyataan di C1 dan C2 |

## A2. Quote-match (§6.1)
| Aturan di brief | Status | Catatan |
|---|---|---|
| Q-001..Q-005 deny sesuai fixture §9.2 | ✅ | `evaluateQuoteMatch` (913 baris), test offline ada |
| Byte tak ter-decode → abstain | ✅ | `Q-DECODE` |
| Domain EIP-712 hanya dari kontrak terpasang | 🟡 | Ada di kode; belum dibuktikan ulang onchain (RPC tidak terjangkau) |
| Spend policy; gagal baca → `P-UNAVAIL` abstain | ✅ | Disebut README dan kode store |

## A3. Simulasi dan token risk (§6.2, §6.3)
| Aturan di brief | Status | Catatan |
|---|---|---|
| Simulasi via metode yang diuji | 🟡 | Memakai `eth_simulateV1`. Brief minta diuji terhadap swap v4 ber-hook dan curve Pons; tidak ada bukti tx uji |
| Klasifikasi `kind` dari alamat, bukan ticker | ✅ | Kode `token-risk.ts` (921 baris) |
| Holder dari Blockscout, tidak mengarang angka | ✅ | `holders.ts`; fallback ke log Transfer |
| Ambang T-TAX/T-HOLDER kosong di config | ✅ | Sesuai brief (lapor angka mentah) |

## A4. Lapisan zk (§8.3)
| Aturan di brief | Status | Catatan |
|---|---|---|
| Groth16 via SP1/RISC Zero, verifier di 4663 | ❌ | Guest Rust ada (111 baris); tidak ada pipeline prover, tidak ada kontrak yang ter-deploy (C2) |
| Halo2-KZG + verifier Solidity via snark-verifier | ❌ | Hanya `lib.rs` 130 baris; tidak ada prover, tidak ada verifier (C2) |
| Dua jalur, public input sama | ❌ | Belum ada kedua-duanya yang nyata |
| `attestation.zk.scope = "quote"` | ✅ | Dikunci di kontrak dan kode |
| `GET /v1/attestation/{id}` | ✅ | Route ada |
| Cek precompile 0x06-0x08 di 4663 | ⚪ | Diklaim README, tidak terverifikasi di audit ini |

## A5. Daftar "lulus uji" (§9)
| # | Syarat | Status | Apa yang kurang |
|---|---|---|---|
| 1 | `/v1/guard` mainnet, satu swap | ❌ | Live 308; tidak ada dump JSON mainnet |
| 2 | Fixture quote-match + signer menolak (b)-(e) | 🟡 | Test offline ada; hasil tidak dijalankan penuh di sini |
| 3 | Simulasi swap v4 dan curve cocok dengan saldo onchain | ❌ | Tidak ada tx uji yang tercatat di repo |
| 4 | Token risk membedakan jenis (sampel nyata) | 🟡 | Test testnet gagal di sini (jaringan) |
| 5 | Perm/terminal tidak bisa menandatangani tanpa guard | ❌ | Tidak ada kode Perm/terminal di repo |
| 6 | MCP `check_token` dan `guard_bundle` | 🟡 | 5 tool ada; bergantung API hidup |
| 7 | Billing: kredit habis → 402 payable di 4663 | 🟡 | Kode ada; belum terbukti live |
| 8 | Fail-closed saat API/RPC mati | ✅ | `client.ts` mengembalikan abstain; signer menolak |
| 9 | Buyback tercatat | 🟡 | Config ada; sesuai brief (otomatis = Phase 2) |
| 10 | Proof Groth16 lolos di kontrak verifier di explorer | ❌ | Tidak ada verifier ter-deploy, tidak ada `verifyTx` |
| Latensi | p95 < 800 ms dilaporkan | ❌ | Tidak ada pengukuran |

---

# BAGIAN B: Temuan di Smart Contract / Lapisan zk
> **Kenapa bagian ini paling penting:** zk dijual sebagai "fitur utama yang menarik orang" (brief §8.3). Kalau palsu, itu risiko reputasi terbesar.

## C1. "Bukti zk" Path B tidak membuktikan apa-apa 🔴 · *dari kode*
> **Status: ✅ diperbaiki.** `verifyAndRecordCommitmentProof`, `recordVerifiedBatchRoot` dan Path B di `packages/zk/src/index.ts` dihapus. `verified` hanya diset dari receipt `verifySp1QuoteProof`.
> Bukti: `packages/zk/contracts/ZGuardQuoteVerifier.sol` + `packages/zk/foundry/test/ZGuardQuoteVerifier.t.sol` · `cd packages/zk/foundry && forge test -vv` · 7/7 lulus (publicValues/proof palsu → revert, scope bukan "quote" → revert, non-owner tidak bisa ganti config) · `apps/api/test/zk-honesty.test.ts` 7/7 · commit `f1f064d`

**Masalahnya apa**
`proveQuoteAttestationAsync` (`packages/zk/src/index.ts`, path B) membuat titik `P = scalar × G1`, lalu memeriksa `e(P, G2) × e(−P, G2) = 1`. Persamaan ini **selalu benar untuk titik mana pun** (e(P,Q)·e(−P,Q) = 1 secara matematika). Kontrak `ZGuardQuoteVerifier.verifyAndRecordCommitmentProof` memeriksa hal yang sama (`verifyBn254PairingEquation(a, b, negA, b)`) plus `a == keccak(publicValues) × G1`, nilai yang bisa dihitung siapa pun. Tidak ada rahasia, tidak ada sirkuit, tidak ada hubungan dengan logika quote-match.

**Kenapa penting**
Siapa pun bisa memanggil fungsi itu dengan `publicValues` bebas (misalnya `verdict = allow` untuk transaksi jahat) dan kontrak akan mencatat `verifiedDecisionIds = true` dan mengeluarkan event "QuoteVerdictVerified". Selain itu fungsinya tidak dibatasi `onlyOwner`. Menyebutnya "Groth16 verified" menyesatkan.

**Contoh kejadian**
Penyerang menghitung `a = keccak(pv) × G1` sendiri, mengirim `pv` berisi verdict allow palsu. Explorer menampilkan event "verified". Pihak ketiga yang mengira ini bukti nyata percaya pada verdict itu.

**Cara memperbaiki**
Hapus klaim "Groth16"/"verified" untuk Path B. Pakai verifier SP1 gateway asli (`verifySp1QuoteProof`, sudah ada) dengan proof dari prover SP1 sungguhan. Untuk Path B: ganti dengan nama jujur ("commitment-only, tidak membuktikan") atau hapus. Tambah kontrol akses atau hapus fungsi `verifyAndRecordCommitmentProof`.

**Bedanya setelah diperbaiki**
Event "verified" hanya muncul kalau ada proof yang tidak bisa dipalsukan. Klaim di web dan README sesuai kenyataan.

## C2. SP1 dan Halo2 hanya kerangka; verifier tidak ter-deploy 🔴 · *dari kode + env*
> **Status: 🟡 sebagian.** Bagian yang bisa dikerjakan tanpa infra sudah selesai: crate `packages/zk/quote-rules` (`no_std`, dipakai guest) dengan vektor lintas bahasa yang byte-identik dengan TS `encodeQuotePublicValues`; guest SP1 meng-commit komitmen yang sama; `buildSp1GuestInput` di `packages/zk/src/index.ts`; Halo2 diberi label skeleton dan dimatikan default (`ZGUARD_ZK_HALO2_ENABLED=false`); API mengembalikan `pending` + `note` jujur. **Belum:** `cargo prove build`, `programVKey`, proof Groth16, deploy verifier/gateway di 46630, dan `verifyTx`. Semuanya butuh toolchain SP1, prover network (`NETWORK_PRIVATE_KEY`) dan wallet deploy.
> Bukti: `cd packages/zk/quote-rules && cargo test` · 5/5 lulus (vektor quoteHash `0x00cfe0ab…c86366`) · live: `POST /v1/verify` fixture allow/deny Q-001 → attestation `pending`, note "SP1 prover not configured…" · commit `375ff65`, `56e69cf`

**Masalahnya apa**
- `ZGUARD_ZK_VERIFIER_ADDRESS=""` di `.env.example`; tanpa alamat, kode memakai `DRY_RUN_VERIFIER_SLOT_ADDR` (simulasi). `verifyTx` tidak pernah ada. Web menampilkan "simulated via eth_simulateV1".
- Path A (SP1) hanya meneruskan ke `ZGUARD_ZK_SP1_PROVER_URL` (kosong); tidak ada kode yang memanggil SDK prover SP1/RISC Zero, tidak ada `programVKey` yang dihasilkan dari build guest.
- Halo2: hanya `lib.rs`. Tidak ada kode prover, tidak ada verifier Solidity hasil `snark-verifier`, tidak ada integrasi ke API. Brief §8.3 meminta keduanya (Halo2 sebagai target).
- Guest SP1 dan sirkuit Halo2 belum terbukti kompilasi (tidak ada CI dan tidak ada `cargo build` terdokumentasi).

**Kenapa penting**
Kriteria sukses §9.10 (proof lolos di verifier 4663 dan tx terlihat di explorer) tidak bisa dipenuhi. README mengklaim ✅ untuk baris 22-25.

**Contoh kejadian**
Reviewer Bos membuka halaman zk, melihat "proven", lalu mencari `verifyTx` di Blockscout. Tidak ada.

**Cara memperbaiki**
(1) `cargo prove build` untuk guest, simpan `programVKey`. (2) Integrasikan SP1 SDK (prover network) untuk menghasilkan proof Groth16. (3) Deploy `ZGuardQuoteVerifier` atau pakai gateway SP1 yang ter-deploy di 4663 (cek dulu), isi alamat di env produksi, simpan tx deploy. (4) Kirim `verifySp1QuoteProof` untuk fixture allow dan `deny Q-001`, catat tx hash. (5) Halo2: tulis prover, generate verifier Solidity, atau turunkan klaim sesuai brief ("Halo2 belum selesai, marketing hanya Groth16"). (6) Verifikasi source kontrak di Blockscout.

**Bedanya setelah diperbaiki**
Butir §9.10 punya bukti tx di explorer. Marketing hanya menyebut yang benar-benar live.

## B3. Catatan kecil di kontrak
> **Status: ✅ diperbaiki di kode (deploy + multisig masih tugas operator).** `setGatewayAndVKey` diganti `proposeGatewayAndVKey` → `applyGatewayAndVKey` dengan timelock 2 hari; ownership dua langkah (`transferOwnership` → `acceptOwnership`); `recordVerifiedBatchRoot` dihapus; test Foundry ada. Owner multisig baru bisa dipasang setelah deploy.
> Bukti: `ZGuardQuoteVerifier.sol` baris 87–159 · `forge test` 7/7 · commit `f1f064d`

| Temuan | Kenapa disebut |
|---|---|
| `owner` tunggal EOA, tanpa timelock | Risiko kunci tunggal; siapkan multisig sebelum mainnet |
| `setGatewayAndVKey` bisa diganti owner sesuka hati | Pemilik bisa mengganti verifier lalu "memverifikasi" apa saja |
| `recordVerifiedBatchRoot` hanya percaya owner ("setelah verifikasi off-chain") | Batch tidak diverifikasi onchain, bertentangan dengan semangat zk |
| Tidak ada test Solidity (Foundry/Hardhat) | Kontrak kritis tanpa test sendiri |

## B4. Yang sudah bagus di kontrak ✅
Scope dikunci `keccak256("quote")` (tidak melebar ke simulasi/token risk, sesuai brief). Struktur `verifySp1QuoteProof` memakai gateway SP1 dengan benar secara pola.

---

# BAGIAN C: Temuan di Server / API

## C3. API live tidak bisa dipakai 🔴 · *terbukti live*
> **Status: 🟡 kode diperbaiki, live menunggu redeploy.** `apps/web/next.config.mjs` (`resolveInternalApiUrl`): rewrite `/v1/*` dan `/health` hanya aktif bila URL API diset dan tidak menunjuk ke web itu sendiri (`VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`) atau ke localhost di Vercel. Bila tidak, route `apps/web/src/app/v1/[...path]/route.ts` dan `src/app/health/route.ts` menjawab 503 `{status:"misconfigured", decision:"abstain", codes:["P-UNAVAIL"]}` dengan `no-store`, tanpa redirect.
> Bukti: `next build` dengan `VERCEL=1` tanpa URL → `/v1/config`, `/health`, `GET/POST /v1/guard` = 503 tanpa header `Location`; dengan `ZGUARD_INTERNAL_API_URL` → proxy 200 (`/v1/config`, `/health`, `/v1/metrics`); kasus self-URL dan localhost-di-Vercel → rewrite kosong · commit `2bbda39`. **Sisa:** user set `ZGUARD_INTERNAL_API_URL` di proyek web, deploy proyek API, lalu redeploy.

**Masalahnya apa**
`curl -L https://zguard-delta.vercel.app/health` menghasilkan 308 ke `/health` lagi, berputar. Hal sama untuk `/v1/config`, `/v1/token/...`, `POST /v1/guard`. Hanya halaman `/` yang jalan. `apps/web/next.config.mjs` me-rewrite `/v1/*` dan `/health` ke `ZGUARD_INTERNAL_API_URL`; bila variabel itu tidak diisi di Vercel, tujuan jatuh ke `http://127.0.0.1:8787` yang tidak ada di Vercel. Juga ada dua proyek Vercel (web dan api) tetapi hanya web yang tampak ter-deploy.

**Kenapa penting**
Brief §9 butir 1, 6, 7 membutuhkan API hidup. Tanpa itu MCP, signer, dan billing tidak bisa dipakai siapa pun.

**Contoh kejadian**
Agen memasang MCP, memanggil `guard_bundle`; API tidak terjangkau; hasil `abstain`. Aman, tapi produk tidak berfungsi.

**Cara memperbaiki**
Deploy `apps/api` sebagai proyek Vercel terpisah, isi `ZGUARD_INTERNAL_API_URL` di proyek web, isi env produksi (Neon `DATABASE_URL`, RPC Alchemy, `ZGUARD_X402_PAY_TO`, relayer). Tambah cek `GET /health` ke deploy pipeline. Simpan hasil `curl` sukses sebagai bukti.

**Bedanya setelah diperbaiki**
`/health` dan `/v1/guard` menjawab 200/402 sesuai desain.

## C4. Klien bisa melewati cek `required` 🔴 · *dari kode*
> **Status: ✅ diperbaiki.** `apps/api/src/app.ts` `requiredChecksFromConfig()` (baris ~302) + `tightenCheckModes`: server memaksa cek wajib; body hanya boleh memperketat.
> Bukti: `test/offline.test.ts` blok `[C4]` · dijalankan terhadap `app.ts` lama (`a82c9de`) → 2 test **gagal**; terhadap kode baru → **lulus** · commit `638c75a`

**Masalahnya apa**
`/v1/guard` menjalankan hanya cek yang ada di `body.checks` (`app.ts:870`, `908-946`). `aggregateDecision` hanya mengagregasi cek yang dijalankan (`decision.ts`, `Object.entries(input.checks)`). Jadi permintaan `checks: ["quote"]` di chain 4663 menghasilkan `allow` berdasarkan quote saja, lengkap dengan `payload_hash` dan `expires_at` yang diterima signer. Brief §4.5: ketiga cek `required` untuk `guard_bundle`.

**Kenapa penting**
Terminal atau agen yang menyusun request (atau diserang prompt injection untuk menyusun request) bisa mematikan simulasi dan token risk. Jaminan "tiga cek" hilang.

**Contoh kejadian**
Token scam dengan `mint` terbuka. Request `checks:["quote"]`: quote cocok, verdict `allow`. Signer menandatangani. Seharusnya `T-MINT`.

**Cara memperbaiki**
Biarkan server yang menentukan cek wajib dari config (`ZGUARD_REQUIRED_CHECKS`), bukan dari body. Body hanya boleh menambah cek, tidak mengurangi. Cek yang wajib tapi tidak dijalankan = `abstain`. Tulis test: `checks:["quote"]` pada `/v1/guard` bukan `allow`.

**Bedanya setelah diperbaiki**
`allow` hanya muncul kalau semua cek `required` benar-benar lulus.

## C5. `/v1/register` bisa dikuras gratis 🟠 · *dari kode*
> **Status: ✅ diperbaiki.** Limit per IP (`ZGUARD_REGISTER_LIMIT_PER_IP_PER_HOUR`, default 5) dan per pembayar X-PAYMENT (`ZGUARD_REGISTER_LIMIT_PER_PAYER_PER_HOUR`, default 10) di `app.ts` baris ~447–477, tersimpan di tabel `zguard_rate_limits` (`drizzle/0001_rate_limits.sql`). Kredit gratis 0 di produksi.
> Bukti: `offline.test.ts` blok `[C5]` (429 setelah kuota, kredit produksi 0) · commit `9d586ad`, `665acc2`

**Masalahnya apa**
`/v1/register` memberi `devFreeCreditMicroUsdg` ke setiap tenant baru (`app.ts:327`), tanpa rate limit, CAPTCHA, atau batas per IP (tidak ada middleware rate-limit di `apps/api/src`). Default nilai kredit dev bergantung env; bila dibiarkan di produksi, siapa pun bisa membuat tenant tanpa batas.

**Kenapa penting**
Biaya RPC dan Blockscout ditanggung operator; pendapatan x402 menjadi nol. Bertentangan dengan model bisnis (revenue → buyback).

**Contoh kejadian**
Skrip mendaftar 10.000 tenant, tiap tenant memakai kredit gratis untuk simulasi dan token risk.

**Cara memperbaiki**
Set kredit gratis 0 di produksi (hanya testnet). Tambah rate limit per IP dan per alamat pembayar. Catat kredit gratis sebagai pos biaya.

**Bedanya setelah diperbaiki**
Biaya penyalahgunaan terbatas; pendapatan sesuai pemakaian.

## C6. Tabel kecil temuan API
> **Status: ✅ semua baris diperbaiki.** CORS: allow-list `ZGUARD_CORS_ORIGINS` di API dan header `Access-Control-Allow-Origin: *` dihapus dari `vercel.json` (root dan `apps/web`). Rate limit global `ZGUARD_RATE_LIMIT_PER_MINUTE` (120). Produksi tanpa `DATABASE_URL` → 503 `P-UNAVAIL` (`store.ts:892`). Latensi lewat `GET /v1/metrics` (p50/p95/p99 per route) + `Server-Timing`.
> Bukti: `offline.test.ts` (CORS, 429 global, local store ditolak di produksi, metrik) · lokal: `POST /v1/guard` p50 89 ms / p95 217 ms (18 request, testnet 46630) · commit `9d586ad`, `807a182`

| Temuan | Dampak | Perbaikan |
|---|---|---|
| CORS `*` pada `/v1/*` (`vercel.json`) | Situs mana pun bisa memakai kunci API di browser korban jika kunci bocor | Batasi origin untuk endpoint ber-kunci |
| Tidak ada rate limit global | DoS ringan | Tambah limiter |
| Mode penyimpanan lokal JSON saat `DATABASE_URL` kosong | Kehilangan kredit/nonce saat serverless restart bila salah konfigurasi | Wajibkan Neon di produksi, gagal start tanpa itu |
| Latensi tidak diukur | Target p95 < 800 ms tidak terbukti | Tambah metrik dan laporan |

---

# BAGIAN D: Temuan di Logika Aplikasi (Frontend dan Integrasi)

## C8. Perm dan terminal bukan integrasi nyata 🟠 · *dari kode*
> **Status: 🟡 helper diperbaiki dan dites; integrasi nyata butuh repo Perm/terminal.** Ditemukan dan diperbaiki bug: helper meng-hash payload `type:"evm_tx"` sedangkan signer memverifikasi `type:"intent"`, sehingga `payload_hash` tidak pernah cocok dan helper tidak pernah bisa menandatangani. Web/README sekarang menyebut ini "SDK helper", bukan default-on.
> Bukti: `packages/sdk/src/integrations.ts` + `apps/api/test/c8-integrations.test.ts` · 5/5 lulus (`enabled:false` → `GuardDisabledError` dengan 0 panggilan wallet; deny/abstain → 0 panggilan; allow → tepat 1 `sendTransaction`) · commit `0d6f9b8`, `6a90158`

> **Update 2026-11-26: integrasi Perm selesai di kode (fail-closed, keputusan user).** Repo `github.com/wealthy-org/Perm`, commit `0764b4e` `36070dd` `6ea4ec2` `d6332ac` `91ad4bd` (belum di-push).
> - Browser meng-encode `swapExactInput` dan mengirim hanya byte tx ke `POST /api/zguard`. Server membangun ulang request ZGuard (`lib/zguard/request.ts`), mengunci ke Router resmi + chain + fungsi `swapExactInput`, lalu meneruskan ke `/v1/guard` memakai key server (`PERM_ZGUARD_API_KEY`).
> - Browser memanggil wallet hanya jika keputusan `allow`, `payload_hash` = hash lokal, dan verdict belum kedaluwarsa. Byte yang dikirim ke wallet = byte yang diperiksa (`wallet.sendTransaction`).
> - §9.5: hanya `PERM_ZGUARD_MODE=off` (persis) yang mematikan gate, dan halaman lalu menampilkan banner merah **UNGUARDED**. Key kosong, ZGuard down, kredit habis, `deny`/`abstain`/mismatch/expired → tombol Swap nonaktif dan 0 panggilan wallet.
> Bukti: `scripts/test-zguard-gate.ts` (Perm) · `pnpm test:zguard` · lulus.
> - Hash vector = `computePayloadHash` SDK ZGuard (`0xc4ec…feae`).
> - 8 jalur blokir → 0 wallet send; config hanya `off` persis; 2 mutant dibunuh.
> - `pnpm server:test`, `eslint .`, `tsc`, `next build`, `audit:bundle` lulus.
> Bukti live lokal: Perm `next dev` → `/api/zguard` → API ZGuard → RHC 46630.
> - `payload_hash` dari API = hash browser; quote-match ZGuard meng-encode ulang calldata Perm byte-per-byte (`allow`).
> - Fixture dengan tanda tangan quote palsu → `deny S-REVERT`.
> - Target selain Router / calldata `approve` → 400.
> **Temuan:** token fixture Perm yang owner-mintable (NVDA·T, AAPL·T, SPCX·T, OPENAI·T, ANTHROPIC·T) → `deny T-MINT`; token saham RH testnet (TSLA, AMZN, PLTR, NFLX) → token risk `allow`. Tidak ada bypass.
> **✅ Lulus live 2026-11-26 (mainnet 4663, keputusan user: swap sangat kecil).** Perm `perm-iota.vercel.app` (env `PERM_ZGUARD_API_KEY` terpasang, banner "ZGuard on") → swap 0.00002 ETH → NVDA.
> - Tx `0x88eeccb938fa5c8472ce610d186ed3624c2fbcdbfc54ce84a707e478acf049f2`, blok 123436315, status success, fee 0.00000817943091 ETH.
> - `SwapSettled` dari Router resmi `0x155b…2Ea2`: account = recipient `0x141D…86a8`, amountIn 0.00002 ETH, amountOut 0.000221787732663172 NVDA (`0xd060…9EEC`), quoteId `0x2822…7e9f`.
> - Gate hanya memanggil wallet setelah verdict `allow` yang hash-nya cocok, jadi tx yang settle membuktikan jalur `allow` live: Perm → `/api/zguard` → ZGuard `/v1/guard` (eip155:4663) → wallet.
> **Temuan [C8-7702]:** wallet user adalah smart account MetaMask EIP-7702 (EOA code `0xef0100…63c0…e32b`). Tx dikirim ke DelegationManager `0xdb9b…47db3` (`redeemDelegations`, selector `0xcef6d209`), yang memanggil `swapExactInput` Router (selector muncul tepat 1×). Verdict ZGuard mencakup panggilan Router di dalamnya, bukan wrapper atau caveat yang ditambahkan wallet. Wallet milik user sendiri, jadi risikonya diterima; dicatat sebagai batas cakupan.
> **Sisa:** approve/Permit2 belum di-gate (jumlah persis ke Router/Permit2 resmi); repo terminal belum ada.

**Masalahnya apa**
`createPermRouterGuard` dan `createTerminalSwapGuard` (`packages/sdk/src/integrations.ts`, 201 baris) adalah helper yang harus dipanggil pihak lain. Tidak ada kode Perm atau terminal di repo, tidak ada PR ke repo mereka, dan tidak ada tes bahwa mematikan guard menolak signer (§9.5).

**Kenapa penting**
Distribusi default-on adalah moat utama menurut brief §2.5 dan §1.1.

**Contoh kejadian**
Terminal merilis tanpa memanggil helper; guard tidak pernah aktif tetapi README menyebut ✅.

**Cara memperbaiki**
Buat PR integrasi di repo Perm dan terminal (butuh akses dari Bos), tambahkan tes "guard dimatikan → signer menolak / UI hard-fail", dan dokumentasikan alamat deployment Perm (brief: [PERLU CEK]).

**Bedanya setelah diperbaiki**
Butir §9.5 punya bukti.

## D3. Tombol "Connect Wallet" tidak muncul setelah klik Open Console 🟠 · *UX, dari screenshot + kode*
> **Status: ✅ diperbaiki di kode (uji wallet asli = tugas manual I9 #1–2, #11–13).** Store bersama `apps/web/src/lib/wallet.ts`; `WalletPill` di navbar (desktop + mobile) dan `WalletStatusCard` di atas Console (`apps/web/src/components/WalletButton.tsx`). Status ditampilkan sebagai "not connected" atau alamat singkat + chain, dengan peringatan wrong-chain. Connect hanya memanggil `eth_requestAccounts` + `wallet_switchEthereumChain` (0xb626/0x1237). Bila chain tidak dikenal (4902), parameter jaringan ditampilkan; tidak memanggil `wallet_addEthereumChain` dan tidak ada tanda tangan. Toggle Testnet/Mainnet tersinkron dua arah. Run dan Signer menampilkan petunjuk "connect first".
> Bukti: `apps/web/test/wallet.test.ts` · `cd apps/web && tsx --test test/wallet.test.ts` · 7/7 lulus (urutan panggilan provider persis `[eth_requestAccounts, wallet_switchEthereumChain]`, tanpa metode tanda tangan; event `chainChanged`/`accountsChanged` tersinkron; tanpa wallet → "No EIP-1193 browser wallet") · commit `1fbfc06`

**Masalahnya apa**
Dari landing page, user klik **Open Console** (`Navbar.tsx:129`) dan masuk ke `/#/console`. Di layar pertama tidak ada tombol Connect Wallet dan tidak ada status wallet. Fungsi `connectBrowserWalletToRhc` sudah ada (`zguard-api.ts:258`) tetapi tombolnya baru muncul jauh di bawah, di langkah "Signer" (`ConsolePage.tsx:~909`), tersembunyi di bagian bawah halaman. Navbar juga tidak punya tombol connect.

**Kenapa penting**
Tujuan Open Console adalah user langsung bisa mencoba guard dengan wallet sendiri. Kalau tombol connect tidak terlihat, user mengira console hanya demo statis dan keluar sebelum mencoba alur signer (inti produk).

**Contoh kejadian**
Calon pengguna dari X klik Open Console, melihat skenario dan kartu kosong "awaiting aggregate decision", tidak menemukan cara login wallet, lalu menutup halaman.

**Cara memperbaiki**
1. Tambah tombol **Connect Wallet** di navbar dan di bagian atas Console (dekat pemilih Testnet/Mainnet), bukan hanya di langkah Signer.
2. Setelah klik Open Console, tampilkan status: belum terhubung / alamat singkat + chain.
3. Saat connect, otomatis minta ganti ke chain yang dipilih (46630 atau 4663) lewat `wallet_switchEthereumChain`, sudah ada di kode.
4. Tombol Run/Signer menampilkan petunjuk "connect dulu" bila belum terhubung. Sinkronkan toggle Testnet/Mainnet dengan chain wallet.
5. Jangan minta tanda tangan atau transaksi saat connect; hanya `eth_requestAccounts`.

**Bedanya setelah diperbaiki**
User tiba di Console, langsung melihat Connect Wallet di atas, terhubung dalam satu klik, dan bisa mencoba alur allow/deny sampai popup wallet.

## D2. Temuan di web
> **Status:** baris 1 ✅: `ZkPage.tsx` ditulis ulang; tidak ada `setTimeout` palsu dan tidak ada teks "simulated via eth_simulateV1"; hanya status asli dari `/v1/attestation` (pending + alasan, proven, verified, failed) (commit `56e69cf`). Baris 2 ⏸: fixture mainnet ditunda (Bagian L), skenario Console testnet kini membawa `tx` eksak. Baris 3 🟡: menunggu C3 live. Baris 4: tidak perlu diubah.

| Temuan | Dampaknya ke user | Perbaikan |
|---|---|---|
| Halaman zk memakai animasi `setTimeout` dan teks "simulated via eth_simulateV1" | Terlihat seperti bukti padahal simulasi | Tampilkan status asli; sembunyikan sampai proof nyata ada |
| Contoh ConsolePage memakai alamat Mock USDG testnet | Demo tidak mewakili mainnet | Tambah fixture mainnet 4663 |
| Dashboard tenant ("Receipt") ada tetapi bergantung API (C3) | Kosong di live | Selesai setelah C3 |
| Kunci API ditampilkan dengan prefix `zg_` | Sesuai [ASUMSI] brief | Tidak perlu diubah |

---

# BAGIAN E: Test, Otomasi, dan Operasional
> **Status:** C6 ✅ (`pnpm test` = offline 61/61 + web 7/7; `test:live`, `test:sol`, `test:rust`; CI `.github/workflows/ci.yml`) · CI ✅ · Foundry ✅ 7/7 · `cargo test` ✅ 5/5 (quote-rules; `cargo prove build` belum, butuh toolchain SP1) · C7 ⏸ (Bagian L) · audit/monitoring/multisig ❌ (operator) · C9 ✅ · `__MACOSX/` ✅ · salinan brief ✅ · onchain ✅ (lihat I6).

| Temuan | Kenapa disebut | Perbaikan |
|---|---|---|
| **C6.** 6 dari 11 test api gagal saat dijalankan (5 lulus). `acceptance.test.ts` gagal sebelum selesai | README klaim "20/20" tidak bisa direproduksi | Buat `pnpm test` membangun mcp dulu; pisahkan test offline (wajib lulus) dari test live (butuh RPC); catat hasil |
| Tidak ada CI (`.github` tidak ada) | Regresi tidak tertangkap | Tambah GitHub Actions: install, build, typecheck, test offline |
| Tidak ada test kontrak Solidity | Verifier kritis tanpa test | Tambah Foundry test |
| Test zk Rust tidak ada, tidak ada `cargo` di pipeline | Guest dan sirkuit tidak terbukti kompilasi | Tambah `cargo test` di CI |
| **C7.** Default `ZGUARD_ACTIVE_CHAIN_ID` testnet 46630 | Brief: inti produk harus benar di 4663 dulu | Ubah default produksi ke 4663, test acceptance mainnet |
| Tidak ada audit, monitoring, alert, multisig | Siap-mainnet belum | Rencanakan sebelum mainnet |
| **C9.** README klaim ✅ melebihi bukti (baris 22-25, 15, 17) | Menyesatkan head dev dan Bos | Perbarui status README dengan bukti (link tx / log) per butir |
| `__MACOSX/` ikut di-commit | Sampah repo | Hapus dari git, tambah ke `.gitignore` |
| Salinan brief ada di repo (`dev-brief-zguard.md`) | Dua versi bisa berbeda | Satu sumber kebenaran |
| Onchain: USDG EIP-3009, domain, precompile 0x08, Pons V2: hanya dari README | **Dari docs, belum diverifikasi di audit ini** | Anak dev lampirkan output `eth_getCode`, `DOMAIN_SEPARATOR()`, panggilan 0x08 |

---

# BAGIAN F: Urutan Pengerjaan
> **Logika urutannya:** perbaiki yang membuat klaim palsu atau bypass keamanan dulu, lalu hidupkan produk, baru lengkapi brief, terakhir kesiapan mainnet.

### P0: Segera (tanpa deploy kontrak baru)
| # | Pekerjaan | Kenapa duluan |
|---|---|---|
| 1 | C4: server menentukan cek `required`; test `checks:["quote"]` bukan `allow` | Bypass keamanan inti |
| 2 | C1/C9: hapus klaim "Groth16 verified" dan ✅ zk di README dan web sampai ada proof nyata | Klaim palsu di depan publik |
| 3 | C5: kredit gratis 0 di produksi, rate limit `/v1/register` | Kebocoran biaya |
| 4 | C3: perbaiki deploy API dan rewrite web, simpan bukti `curl` 200 | Produk tidak jalan |
| 5 | C6: perbaiki script test (build mcp), pisahkan test offline dan live | Dasar pembuktian |
| 5b | D3: pindahkan Connect Wallet ke navbar dan atas Console, sinkron chain | Perbaikan UX kecil, user bisa langsung mencoba |

### P1: Integritas
| # | Pekerjaan | Kenapa duluan |
|---|---|---|
| 6 | Tambah CI (install, build, typecheck, test offline, cargo build) | Cegah regresi |
| 7 | Verifikasi onchain dan lampirkan output: USDG EIP-3009 + domain, precompile 0x06-0x08, factory Pons V2, PoolManager | Fakta brief ditandai [PERLU CEK] |
| 8 | Test Foundry untuk `ZGuardQuoteVerifier` | Kontrak kritis |

### P2: Memenuhi brief
| # | Pekerjaan | Kenapa duluan |
|---|---|---|
| 9 | Pipeline SP1: build guest, `programVKey`, proof Groth16, deploy verifier/gateway, tx `verifyTx` untuk fixture allow dan `deny Q-001` (§9.10) | Fitur utama brief |
| 10 | Halo2-KZG: prover + verifier Solidity, atau nyatakan belum selesai | Target brief |
| 11 | Acceptance mainnet 4663: dump JSON `/v1/guard` untuk USDG, Stock Token, curve Pons, pool graduate; tx uji simulasi vs saldo onchain (§9.1, 9.3, 9.4) | Bukti kriteria sukses |
| 12 | Integrasi nyata Perm dan terminal + tes guard-off menolak (§9.5) | Distribusi default-on |
| 13 | Billing live: tx x402 USDG sukses, 402 saat kredit habis (§9.7) | Pendapatan |
| 14 | Ukur dan laporkan latensi p95 | Brief meminta dilaporkan |

### P3: Sebelum mainnet
| # | Pekerjaan | Kenapa duluan |
|---|---|---|
| 15 | Default ke 4663, multisig + timelock untuk owner verifier, verifikasi source di Blockscout | Keamanan operasi |
| 16 | Audit pihak ketiga, monitoring, alert RPC/Neon | Kesiapan produksi |
| 17 | Bersihkan repo (`__MACOSX`, salinan brief), satu sumber README yang benar | Kebersihan |

## Penilaian Akhir
| Aspek | Skor 1-5 | Artinya |
|---|---|---|
| Kerangka dan kualitas kode | 4 | Rapi, typecheck bersih, desain fail-closed baik |
| Kepatuhan fitur inti (quote-match, signer, MCP) | 3,5 | Ada, sebagian besar sesuai brief; bypass C4 |
| Lapisan zk | 1 | Kerangka; klaim melebihi kenyataan |
| Kesiapan live/produksi | 1,5 | API tidak hidup, tanpa CI, tanpa bukti mainnet |
| Kejujuran status (README vs bukti) | 2 | Banyak ✅ tanpa bukti |

**Kesimpulan:** dasar SDK dan logika keputusan sudah bagus dan mengikuti brief. Yang belum benar: bukti zk yang dijual sebagai fitur utama tidak membuktikan apa-apa, API publik tidak hidup, klien bisa melewati cek wajib, dan tidak ada bukti mainnet. Kerjakan P0 dulu, lalu P2 butir 9 dan 11 untuk memenuhi brief. Batasan audit ini: RPC RHC tidak terjangkau dari mesin audit, jadi semua fakta onchain dan test live perlu diulang di mesin anak dev.

---

# BAGIAN G: Update setelah perbaikan dan uji e2e (2026-11-25)

## Koreksi atas audit di atas
| Temuan awal | Koreksi | Penyebab |
|---|---|---|
| C6: "6 dari 11 test gagal" | **Salah untuk repo.** Setelah `@zguard/mcp` di-build, **20/20 lulus** (10 test live mainnet 4663 + 10 test live testnet 46630) | Kegagalan awal berasal dari mesin audit: mcp belum di-build dan `curl` terblokir. Node bisa menjangkau RPC RHC. Script `test` repo memang rapuh (tidak build mcp), itu tetap diperbaiki |
| C5: kredit gratis di produksi | **Diperkecil.** Default `devFreeCreditMicroUsdg` sudah `0` bila `NODE_ENV=production` (Vercel). Yang tersisa: belum ada rate limit `/v1/register` | Saya melewatkan baris default di `config.ts` |
| "Onchain tidak terverifikasi" | Sebagian terverifikasi lewat test live: 5 jenis token di mainnet, simulasi `eth_simulateV1`, 402 + EIP-3009 USDG di 4663, sequencer up | Test memakai RPC publik via Node |

## Perbaikan yang dikerjakan (lokal, **belum di-commit/push/deploy**)
| Temuan | Perubahan | Bukti |
|---|---|---|
| C4 cek `required` bisa dilewati | `apps/api/src/app.ts`: server memaksa cek wajib dari config; `options.checkModes` hanya boleh memperketat | `test/offline.test.ts`: `checks:["quote"]` tetap menjalankan simulasi + token_risk dan tidak `allow`; downgrade ke advisory ditolak. 4/4 lulus. Catatan: test belum dijalankan terhadap kode lama untuk melihat gagal dulu |
| C6 script test | `apps/api/package.json`: `test` build sdk/zk/mcp dulu; ada `test:offline` dan `test:live` | 20/20 lulus |
| C3 loop 308 di Vercel | `apps/web/next.config.mjs`: rewrite hanya aktif bila API dikonfigurasi (atau bukan Vercel); `/health` dan `/v1/*` fallback mengembalikan 503 fail-closed, bukan loop | Dicek lokal: `/health` via web mengembalikan JSON API; `next build` lulus. **Live Vercel belum diperiksa ulang, perlu redeploy dan set `ZGUARD_INTERNAL_API_URL`** |
| D3 Connect Wallet | `apps/web/src/lib/wallet.ts` (store bersama), tombol di navbar dan di atas Console | Browser: tombol terlihat di keduanya; tanpa wallet muncul pesan "No EIP-1193 browser wallet"; dengan wallet tiruan keduanya berubah ke `0x1111…1111`; hanya `eth_requestAccounts` + `wallet_switchEthereumChain` (0xb626), tanpa permintaan tanda tangan |

## Hasil e2e
| Lapisan | Hasil |
|---|---|
| Typecheck 5 proyek | Lulus |
| API test live (mainnet 4663 + testnet 46630) | 20/20 lulus |
| API offline (fail-closed, C4, C5) | 4/4 lulus |
| Web UI lokal → API lokal → RHC testnet | Skenario Mock USDG spoof: quote allow, simulasi allow, token_risk deny `T-MINT, C-FINDING, T-LP`, keputusan `deny`, 1725 ms, holder 19.083 dari Blockscout |
| UI wallet guard (wallet tiruan, tanpa tanda tangan nyata) | "Tamper payTo": wallet tidak dipanggil (diblokir sebelum popup). "Sign Valid": guard live `allow`, lalu `eth_signTypedData_v4` dipanggil |

## Belum dikerjakan / belum terbukti
- **C1 dan C2 (zk) belum diperbaiki.** Test §9.10 lulus, tetapi hanya membuktikan tautologi pairing (C1). Lulusnya test **tidak** berarti zk valid. Perlu keputusan: hapus klaim "Groth16 verified" sekarang atau bangun pipeline SP1 sungguhan.
- Verifier tidak ter-deploy; tidak ada `verifyTx` di explorer. Deploy butuh wallet testnet ber-ETH (faucet) dan kunci milik user.
- Dari enam skenario UI, hanya Mock USDG spoof yang dijalankan di layar; skenario lain hanya tercakup lewat test API.
- Penandatanganan wallet asli (MetaMask/Rabby) belum dicoba, hanya wallet tiruan.
- Rate limit `/v1/register`, CI, test Foundry, C8 (Perm/terminal), tes mainnet via UI belum dikerjakan.
- Perubahan belum di-commit, belum di-push, belum di-deploy ke Vercel.

---

# BAGIAN H: Tugas untuk anak dev: bangun zk SP1 yang asli (C1 + C2)
> **Keputusan head dev (2026-11-25):** SP1 dibangun oleh anak dev, bukan di sesi audit. Bagian ini adalah brief kerjanya. Urutan wajib dari atas ke bawah. Tidak ada estimasi waktu.

## H0. Kondisi awal yang sudah dicek
| Hal | Kondisi | Dampak ke tugas |
|---|---|---|
| Guest SP1 `packages/zk/sp1-quote-guest/src/main.rs` | Ada, logika Q-001..Q-007 benar secara isi | Dipertahankan, tapi harus dibuktikan bisa dikompilasi |
| `cargo-prove` di mesin audit | Terpasang | Build guest bisa dicoba anak dev |
| Docker daemon di mesin audit | **Tidak berjalan** | Proof Groth16 lokal memakai Docker |
| RAM mesin audit | 16 GB | Terlalu kecil untuk Groth16 lokal. Pakai prover network atau mesin besar |
| `NETWORK_PRIVATE_KEY` (SP1 prover network) | Tidak ada | Kunci milik tim; **jangan di-commit**, taruh di env lokal/secret Vercel |
| Verifier ter-deploy | Belum ada (`ZGUARD_ZK_VERIFIER_ADDRESS=""`) | Wajib dikerjakan di langkah H4 |

## H1. Hapus yang menyesatkan lebih dulu (C1)
> **Status: ✅ selesai.** Lihat C1 (commit `f1f064d`, `56e69cf`, `aba2ded`).

1. Hapus `verifyAndRecordCommitmentProof` dari `ZGuardQuoteVerifier.sol` dan seluruh "Path B" di `packages/zk/src/index.ts` (ecMul/ecPairing tautologi).
2. Ganti teks web ("proven", "simulated via eth_simulateV1") dan README baris 22-25 agar hanya menyebut yang benar-benar terbukti.
3. Status `attestation.zk.status` hanya boleh `verified` bila ada `verifyTx` yang sukses di chain.
4. **Kriteria selesai:** tidak ada kode yang bisa mencatat "verified" tanpa proof SP1 asli. Tulis test negatif: memanggil verifier dengan `publicValues` bebas dan proof palsu harus **revert**.

## H2. Build guest dan ambil `programVKey`
> **Status: ⛔ belum (butuh toolchain SP1 `cargo prove`; tidak tersedia di sandbox kerja).** Guest + crate aturan sudah siap dikompilasi; `packages/zk/sp1-quote-guest` memakai `zguard-quote-rules`.

1. Dari `packages/zk/sp1-quote-guest`: `cargo prove build`. Pin versi `sp1-zkvm` dan SDK ke versi yang sama dengan `cargo-prove` yang dipakai (`cargo prove --version`); catat di README.
2. Buat crate host (misal `packages/zk/sp1-host`) yang memakai `sp1-sdk`: `ProverClient`, `setup(ELF)` → simpan `vk.bytes32()` sebagai `programVKey`.
3. Simpan ELF atau hash ELF dan `programVKey` di repo (`packages/zk/artifacts/`), supaya orang lain bisa memeriksa bahwa vkey cocok dengan source.
4. **Kriteria selesai:** `cargo prove build` lulus di CI; `programVKey` tercetak dan tersimpan.

## H3. Samakan input guest dengan SDK TypeScript
> **Status: ✅ sebagian besar.** Vektor lintas bahasa (TS `encodeQuotePublicValues` == Rust `quote-rules`) untuk quoteHash/txHash/scopeHash/verdict/bitmask; `buildSp1GuestInput` mengisi input guest dari request yang sama. Guest membuktikan Q-001/Q-002/Q-005/Q-DECODE; Q-003/004/006/007 dilaporkan sebagai `hinted_mask` (host hint, tidak diklaim terbukti). Paritas lewat `client.execute` SP1 menunggu H2.

1. `QuoteWitness` harus diisi **dari hasil `evaluateQuoteMatch` di SDK** (bukan dihitung ulang dengan cara lain). Tulis fixture bersama (JSON) yang dipakai test TS **dan** test Rust.
2. `ruleBitmask`: tetapkan satu tabel bit ↔ kode (`Q-001`..`Q-007`, `Q-DECODE`, `P-401`, `P-UNAVAIL`) dan pakai di Rust, Solidity, dan TS.
3. Tambah test paritas: untuk setiap fixture (allow, deny Q-001, deny Q-002, abstain decode, tanpa quote Q-005) verdict dan bitmask dari TS == dari guest (jalankan guest dengan `client.execute`, tanpa proof, cepat).
4. Perhatikan: `witness_salt` harus acak per keputusan agar `quoteHash`/`txHash` tidak bisa ditebak; simpan salt bersama receipt.
5. **Kriteria selesai:** test paritas lulus untuk semua fixture §9.2 dan fixture zk §9.10.

## H4. Proof Groth16 dan verifikasi onchain di RHC
> **Status: 🟡 langkah 2a ✅ (precompile non-tautologi, lihat I6); sisanya ⛔ butuh prover network + wallet deploy.** Skrip `pnpm deploy:verifier` hanya mengizinkan testnet.

1. Hasilkan proof `Groth16` (`prove(...).groth16().run()`). Dua jalur, pilih sesuai mesin:
   - **Prover network** (disarankan; mesin kecil): isi `NETWORK_PRIVATE_KEY` dan `SP1_PROVER=network` di env. Biaya ditanggung tim.
   - **Lokal**: butuh Docker aktif dan RAM besar; tidak cocok untuk laptop 16 GB.
2. **Cek dulu (brief §8.3):** (a) precompile BN254 0x06/0x07/0x08 aktif di 4663 dan 46630 dengan kasus uji yang **tidak tautologi** (pairing yang benar vs yang salah harus beda hasil); (b) apakah SP1 Verifier Gateway sudah ter-deploy di 46630/4663. Jika belum, deploy `SP1VerifierGroth16` dari repo resmi SP1 untuk versi yang sama dengan SDK, lalu deploy `ZGuardQuoteVerifier` yang menunjuk ke sana (`verifySp1QuoteProof` sudah ada).
3. Deploy ke **testnet 46630 dulu**. Simpan alamat dan tx deploy di `packages/zk/deployments/46630.json`. Verifikasi source di Blockscout.
4. Pindahkan kunci deploy/relayer ke env (`ZGUARD_ZK_VERIFIER_PRIVATE_KEY`), jangan di repo. Pakai wallet testnet khusus dengan ETH faucet.
5. Kirim `verifySp1QuoteProof` untuk dua fixture: **allow** dan **deny Q-001**. Catat `verifyTx` keduanya.
6. **Kriteria selesai (= brief §9.10):** dua `verifyTx` terlihat di explorer, event `QuoteVerdictVerified` berisi verdict yang benar, `scope = keccak256("quote")`.

## H5. Integrasi ke API dan web
> **Status: 🟡 API dan web siap, menunggu prover.** Langkah 1: API memanggil `ZGUARD_ZK_SP1_PROVER_URL` (async); status `pending → proven (eth_call checkSp1QuoteProof) → verified (receipt verifySp1QuoteProof)`. Langkah 2: `/v1/attestation` mengembalikan `proof`, `publicInputs`, `programVKey`, `verifierAddress`, `verifyTx`, `status`, `note`. Langkah 4: ✅ halaman zk jujur. Langkah 5 menunggu H2/H4.

1. `proveQuoteAttestationAsync`: ganti Path A/B dengan pemanggilan prover SP1 (worker terpisah; jangan di fungsi serverless 60 detik karena proof lama). Status: `pending → proven → verified`.
2. `GET /v1/attestation/{decisionId}` mengembalikan `proof`, `publicInputs`, `programVKey`, `verifierAddress`, `verifyTx`, `status`. `payload_hash` di receipt harus terikat ke `quoteHash/txHash`.
3. Verifikasi proof di sisi API sebelum menandai `proven` (SDK `client.verify`), lalu relayer kirim onchain untuk `verified`.
4. Halaman zk: tampilkan status asli, tautan explorer ke `verifyTx`, dan jangan animasi palsu.
5. **Kriteria selesai:** dari UI testnet, satu keputusan `allow` menghasilkan attestation yang berubah `pending → proven → verified` dengan `verifyTx` yang bisa dibuka.

## H6. Test dan CI wajib
> **Status:** Rust `cargo test` ✅ 5/5 · Negatif Solidity ✅ 7/7 · CI ✅ (tanpa `cargo prove build`) · Paritas via execute ⛔ (H2) · E2E testnet ⛔ (H4).

| Test | Harus membuktikan |
|---|---|
| Rust: `cargo test` untuk logika guest | Semua cabang verdict |
| Paritas TS ↔ guest (execute) | Tidak ada selisih verdict/bitmask |
| Negatif Solidity (Foundry) | `publicValues` palsu atau proof palsu → revert; scope selain "quote" → revert; non-owner tidak bisa mengganti gateway/vkey |
| E2E testnet | Dua fixture §9.10 `verified` di explorer |
| CI | `cargo prove build` + test offline + typecheck pada setiap PR; test yang butuh prover network ditandai terpisah |

## H7. Halo2-KZG (target, bukan syarat rilis)
Sesuai brief §8.3: jika belum selesai, rilis dengan Groth16 saja dan marketing hanya menyebut Groth16. Kerjakan hanya setelah H1-H6 hijau. Butuh prover, verifier Solidity via `snark-verifier`, dan public input yang sama dengan jalur SP1.

## H8. Aturan komunikasi sampai semua hijau
- Jangan menulis "Groth16 live" atau "verified" di web, README, atau X sebelum `verifyTx` testnet ada.
- Jangan commit kunci, `NETWORK_PRIVATE_KEY`, atau private key deploy.
- Laporkan balik ke head dev: `programVKey`, alamat verifier/gateway, dua `verifyTx`, dan hasil CI.

---

# BAGIAN I: Checklist tugas anak dev (yang belum selesai + yang harus di-crosscheck)
> **Cara pakai:** kerjakan dari atas. Centang setelah ada bukti (log, tx hash, screenshot, hasil `curl`). Audit ini **belum deep dive penuh**: bagian "Crosscheck" adalah area kode yang belum saya baca teliti, jadi anak dev wajib memeriksanya sendiri dan melapor. Tidak ada estimasi waktu.

## I1. Deploy dan live (blocker)
- [ ] ⛔ **butuh akses Vercel user.** Deploy `apps/api` sebagai proyek Vercel terpisah (env: RPC produksi, `DATABASE_URL` Neon, `ZGUARD_X402_PAY_TO`, relayer). Bukti: `curl https://<api>/health` = 200.
  Status: kode API siap (`apps/api/vercel.json`, `src/vercel.ts`); env yang perlu diisi tercantum di `.env.example` dan README bagian Deploy.
- [ ] ⛔ **butuh akses Vercel user (kode sudah siap).** Isi `ZGUARD_INTERNAL_API_URL` di proyek web, redeploy web dengan perbaikan `next.config.mjs` + route fallback. Bukti: `/health`, `/v1/config`, `/v1/registry` di zguard-delta.vercel.app tidak lagi 308.
  Status: lihat C3. Tanpa env, respons sekarang 503 `misconfigured`, bukan 308.
- [x] Buka Console live: pastikan UI **tidak** menampilkan hasil ALLOW/DENY dari "offline fallback" tanpa label jelas. Tambah banner "API tidak terhubung" bila `/v1/guard` gagal. Bukti: screenshot saat API dimatikan.
  Bukti: `apps/web/src/components/Navbar.tsx` (banner `api-offline-banner` bila `/v1/config` gagal), `ConsolePage.tsx` `run()` (HTTP ≥500 dianggap gagal; log menulis `✗ <alasan>` dan `EXAMPLE FIXTURE (not a live verdict)`) · `next build` lulus · commit `1fbfc06` · screenshot live menunggu deploy
- [x] Badge chain di navbar harus berasal dari `/v1/config`, bukan nilai bawaan.
  Bukti: `Navbar.tsx`: state awal `null` ("RHC · …"), diisi dari `fetchRuntimeConfig()`, "API OFFLINE" bila gagal · commit `1fbfc06`
- [x] Commit dan review perubahan lokal (C4, script test, rewrite web, Connect Wallet) lewat PR. Belum di-commit.
  Bukti: 26 commit per fitur di `main` lokal (`a82c9de` … `6a90158`, daftar di Bagian M). Push dilakukan user (sesuai I8: tanpa PR).

## I2. Keamanan API
- [x] Rate limit `/v1/register` (per IP dan per pembayar) dan rate limit global.
  Bukti: `app.ts` baris ~124 (`MemoryRateLimiter` global) dan ~447–477 (register per IP/payer, tabel `zguard_rate_limits`) · `offline.test.ts` `[C5]` + "global per-IP rate limit returns 429" lulus · commit `9d586ad`
- [x] Pastikan `NODE_ENV=production` di Vercel agar kredit gratis = 0; tambah test.
  Bukti: `config.ts` (`ZGUARD_DEV_FREE_CREDIT_MICRO_USDG` default 0 di produksi) · test "forces free credit to 0 on mainnet production" + "testnet production free credit is opt-in only" lulus · Vercel memasang `NODE_ENV=production` otomatis; `.env.example` juga menyarankan 0
- [x] Jalankan `offline.test.ts` terhadap kode **lama** (stash perbaikan C4) untuk memastikan test benar-benar gagal tanpa perbaikan.
  Bukti: `app.ts` dari `a82c9de` dipasang sementara · `tsx --test --test-name-pattern="checks:\[|downgrade"` · kode lama: `not ok` 2/2; kode baru: `ok` 2/2 · working tree dikembalikan bersih
- [x] CORS `*` pada `/v1/*`: batasi untuk endpoint ber-API-key.
  Bukti: `app.ts` baris ~125–150 (allow-list `ZGUARD_CORS_ORIGINS`; route ber-key tidak dibuka ke origin asing di produksi), `vercel.json` + `apps/web/vercel.json` tanpa header ACAO · test "CORS: keyed routes are not opened…" lulus · commit `9d586ad`, `807a182`
- [x] Wajibkan Neon di produksi; start gagal bila `DATABASE_URL` kosong (jangan jatuh ke JSON lokal).
  Bukti: `apps/api/src/db/store.ts:892` (produksi tanpa DB → error → 503 `P-UNAVAIL`; escape hatch eksplisit `ZGUARD_ALLOW_LOCAL_STORE_IN_PRODUCTION`) · test "refuses the local JSON store when NODE_ENV=production…" lulus

## I3. zk SP1 (C1 + C2)
- [ ] 🟡 **H1 dan H3 selesai, H6 sebagian, H2/H4/H5 butuh infra.** Kerjakan Bagian H berurutan H1 → H6. Bukti akhir: dua `verifyTx` (allow, deny Q-001) di explorer testnet 46630, `programVKey`, alamat verifier.
  Status: lihat status per langkah di Bagian H dan Bagian M.
- [x] Sampai selesai: hapus klaim "Groth16 verified" di web, README, dan X.
  Bukti: `README.md` (tabel "What is real and what is not yet"), `ZkPage.tsx`, `ApiPage.tsx` (zk system = "in progress"), `FaqPage.tsx`, `DocsPage.tsx`, `HomePage.tsx` · `grep -i "simulated via\|proof generated\|snark-verifier"` di views: hanya tersisa deskripsi target Halo2 berlabel skeleton · commit `aba2ded`, `309fec6`, `56e69cf` · **X (Twitter) di luar repo: user yang menghapus**
- [x] Halo2-KZG: setelah H1-H6 hijau, atau nyatakan belum ada.
  Bukti: dinyatakan belum ada: README, web ("Skeleton · not available"), `config.ts` `zkHalo2Enabled` default `false` · commit `56e69cf`

## I4. Kepatuhan brief yang belum ada bukti
- [ ] ⏸ **DITUNDA (mainnet, setelah testnet hijau)** §9.1 dump JSON `/v1/guard` di **mainnet 4663** untuk swap USDG atau Stock Token.
- [x] ✅ **selesai (2026-11-26).** §9.3 satu swap Uniswap v4 ber-hook Pons dan satu trade curve Pons: `balanceChanges` cocok dengan saldo onchain setelah tx uji (wallet dev). Tx revert → `S-REVERT`.
  Bukti: `apps/api/scripts/check-sim-vs-chain.ts` (replay tx yang sudah mined lewat `simulateOnRhc` di state blok parent, bandingkan dengan log `Transfer` + selisih saldo ETH onchain) · `tsx scripts/check-sim-vs-chain.ts <txHash>` ·
  - ✅ swap **graduated Pons v4** (FOLDY, `kind=pons_graduated_v4`, lewat PoolManager `0x8366…0951`) tx `0xfd5b718e…e894` → **MATCH 6/6** (token + ETH semua alamat, termasuk penerima fee)
  - ✅ **tx revert** (`createLaunch` gagal) tx `0xc1b985eb…e9e1` → simulasi `revert`, `deny S-REVERT` → MATCH
  - ✅ curve non-Pons (TOAST, `kind=other`) 3 tx → MATCH 4/4 masing-masing
  - ✅ **trade curve Pons** (KOIP `0x9118…2365`, `kind=pons_curve`, curve `0x7206…F3A5`, `buy(uint256,uint256)` 0.0005 ETH oleh Akun B) tx `0xc00a6ed0a59b9c5e0d0d383f8112f8ce2bff6a5a603532009e9355643e1bdc73` → **MATCH 4/4** (prediksi 195407.229764919120663678 KOIP = onchain; ETH −0.0005 pembeli / +0.0005 curve)
  - Catatan: RPC publik testnet hanya menyimpan state ±20 menit, jadi script harus dijalankan segera setelah tx.
- [ ] 🟡 **test guard-off selesai di SDK; integrasi butuh akses repo Perm/terminal.** §9.5 integrasi nyata di Perm dan terminal; test "guard dimatikan → signer menolak / UI hard-fail". Butuh akses repo Perm dan terminal.
  Bukti (bagian SDK): `apps/api/test/c8-integrations.test.ts` 5/5 · commit `0d6f9b8`
- [ ] 🟡 **402 terbukti lokal; bayar nyata butuh wallet/relayer.** §9.7 tx x402 USDG sukses di chain nyata dan 402 saat kredit habis (dengan relayer sungguhan, bukan simulasi).
  Bukti (sebagian): lokal setelah kredit dev habis → `POST /v1/verify` = HTTP 402 dengan `accepts[0].network = eip155:46630`, asset USDG testnet, `settlement.mode = deposit`, `minConfirmations = 3`. Jalur settlement dites offline (`poc-x402.test.ts`, `deposit.test.ts`).
- [ ] ⛔ **butuh alamat milik ZGuard.** §9.9 buyback: catat penerimaan fee dan alamat treasury di config.
  Status: variabel `ZGUARD_X402_PAY_TO`, `ZGUARD_BUYBACK_WALLET`, `ZGUARD_PONS_TOKEN_ADDRESS` terdokumentasi di `.env.example`; nilainya diisi user.
- [x] Ukur dan laporkan latensi p95 `/v1/guard` (target < 800 ms) dan quote-match lokal (< 10 ms).
  Bukti: `GET /v1/metrics` (`LatencyRecorder`, `app.ts` ~123) · lokal → RPC testnet 46630 publik: `POST /v1/guard` 18 request p50 89 ms, **p95 217 ms**, 0 error 5xx · quote-match offline < 10 ms dites di `acceptance.test.ts` §9.1 · angka produksi diambil ulang setelah deploy
- [ ] ⏸ **DITUNDA (mainnet, setelah testnet hijau)** Default produksi ke 4663 (saat ini tetap testnet 46630), plus acceptance mainnet via UI.
- [x] Skenario UI: jalankan keenam skenario Console di **testnet** (mainnet ditunda), simpan screenshot dan JSON.
  Bukti: `apps/web/scripts/check-console-scenarios.ts` (memakai `buildScenarios` dari Console, lewat proxy web → API → RHC 46630) · 6/6 PASS: ok=allow (usdg), pons=allow (pons_curve), stock_or_grad=allow (pons_graduated_v4), spoof=deny `T-MINT,C-FINDING,T-LP`, approve=deny `Q-006,S-APPROVE`, undecodable=abstain `Q-DECODE,S-FAIL` · commit `d95750b` · screenshot live menunggu deploy
- [ ] ⛔ **butuh browser + wallet asli.** Uji wallet asli (MetaMask/Rabby/Robinhood Wallet): Connect, Sign Valid (popup muncul), Tamper (tidak ada popup).
- [ ] 🟡 Uji tampilan mobile (navbar dengan tombol Connect, Console, Docs).
  Status: tombol `WalletPill` ada di bar mobile (ikon saja di < sm); uji visual di perangkat nyata belum.

## I5. Crosscheck: area kode yang belum saya baca teliti
Periksa satu per satu. Untuk tiap item tulis hasilnya (aman / ada bug + PoC) di bawah daftar ini.
- [x] (sudah dibaca penuh, lihat Bagian J; `eip712.ts` belum) `packages/sdk/src/quote-match.ts` (913 baris) dan `eip712.ts`: cari cara melewati aturan Q-001..Q-007 (checksum address vs huruf kecil, `value` kosong, desimal, `chainId` string vs angka, `uint256` overflow, calldata dengan selector approval yang disamarkan, `permit`/`increaseAllowance`/`setApprovalForAll`, multicall berisi approve). Tulis fuzz test.
- [x] (sudah dibaca, lihat Bagian J) `apps/api/src/services/x402.ts` (615 baris): replay `X-PAYMENT` lintas chain, race dua request dengan nonce sama, `validBefore`/`validAfter`, kredit ganda, pengecekan `to` = pay-to, jumlah kurang bayar, relayer gagal setelah kredit dicatat.
- [x] (sebagian dibaca, lihat Bagian J) `apps/api/src/db/store.ts` (810 baris) dan `drizzle/0000_init.sql`: potong kredit atomik (dua `/v1/guard` bersamaan), isolasi antar tenant (receipt dan attestation tenant lain bisa dibaca?), hash API key, nonce tabel.
- [ ] `apps/api/src/services/token-risk.ts` (921 baris): akurasi klasifikasi `kind`, token ticker kembar, snipe tax, `T-LP` untuk pool v4 hasil graduasi, token `other` dengan mint tersembunyi (proxy/upgradeable), pembacaan owner untuk kontrak non-Ownable.
- [ ] `apps/api/src/services/simulate.ts` (565 baris): swap v4 ber-hook, trade curve Pons, tx yang bergantung timestamp/blok, `S-DIFF` toleransi, simulasi tanpa `from` yang benar.
- [ ] `apps/api/src/services/url-scanner.ts` (306 baris): SSRF lewat redirect, DNS rebinding, IPv6, `0.0.0.0`, port non-standar, batas ukuran dan timeout.
- [ ] `packages/mcp/src/index.ts` dan `packages/sdk/src/cli.ts`: tool berjalan tanpa API key (offline), tidak mengirim data sensitif, skema respons sama dengan §5.3.
- [ ] `packages/sdk/src/signer.ts`: semua jalur tanda tangan terbungkus (`signTypedData`, `signTransaction`, `sendTransaction`, `personal_sign`, `eth_sign`, `wallet_sendCalls`); pastikan tidak ada jalur yang lolos.
- [ ] `packages/sdk/src/content-scan.ts`: prompt injection lewat metadata token, karakter tak terlihat, homoglyph, ticker lookalike terhadap registri Stock Token.
- [x] Web `Docs`, `Architecture`, `Checks`, `Faq`, `Api`: bandingkan setiap klaim dengan perilaku nyata; hapus yang belum benar (zk, Perm/terminal default-on, latensi).
  Bukti: klaim zk (Api/Faq/Docs/Home/Zk) dan Perm/terminal default-on (Home/Docs) disesuaikan; billing Docs menjelaskan mode onchain/deposit · commit `309fec6`, `6a90158`, `e2c8326` · Architecture/Checks tidak memuat klaim zk/Perm.

## I6. Verifikasi onchain independen (jangan hanya percaya test repo)
Jalankan lewat Node/RPC publik atau Alchemy, lampirkan output di PR.
- [x] USDG `0x5fc5…d168` di 4663: `eth_getCode`, `name()`, `version()`, `DOMAIN_SEPARATOR()`, dan `receiveWithAuthorization`/`transferWithAuthorization` aktif.
  Bukti (viem, RPC publik, read-only): kode proxy 170 byte; `name()="Global Dollar"`, `decimals()=6`; **`version()` revert** (tidak ada getter), jadi versi "1" dibuktikan lewat hash: `DOMAIN_SEPARATOR()=0x7a3d7400…62036` == `hash("Global Dollar","1",4663,USDG)` ✓; `TRANSFER_WITH_AUTHORIZATION_TYPEHASH` = typehash EIP-3009 ✓, `RECEIVE_WITH_AUTHORIZATION_TYPEHASH` ada
- [x] Domain EIP-712 USDG di 46630 (testnet) dibaca dari kontrak, bukan disalin dari mainnet.
  Bukti: `DOMAIN_SEPARATOR()=0xb1debe91…2d950b` == `hash("Global Dollar","1",46630,0x7E95…802F)` ✓ · API membandingkan ini saat start (QM-6, commit `5b0c52e`)
- [x] Factory Pons V2 `0x7eD5…EC7e`, meme hook `0xE5e7…e044`, PoolManager `0x8366…0951`: `eth_getCode` tidak kosong, `getLaunchedToken` untuk satu token curve dan satu token graduate.
  Bukti: kode 24177 / 15167 / 24009 byte di 4663 · klasifikasi `pons_curve` dan `pons_graduated_v4` (via `getLaunchedToken`) terbukti live di testnet lewat skenario Console `pons` dan `stock_or_grad`
- [x] Precompile BN254 0x06/0x07/0x08 dengan kasus uji non-tautologi (pairing benar vs salah menghasilkan hasil berbeda).
  Bukti: di 46630 dan 4663: `ecPairing(e(G1,G2)·e(−G1,G2))` → `…01`; `ecPairing(e(G1,G2))` → `…00` (hasil berbeda ✓); `ecAdd(G1,G1)` == `ecMul(G1,2)` = `0x030644e7…` ✓
- [x] Registri Stock Token `api.robinhood.com/rhj/assets` cocok dengan alamat yang dipakai di config dan test (contoh AAPL).
  Bukti: 205 aset; AAPL `deployments[0].contractAddress = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9`, `chainId 4663` == `MAINNET_AAPL` di `RegistryPage.tsx`
- [x] Alamat bertanda [PERLU CEK] di brief (Universal Router, Permit2, Perm): jangan diisi sebelum diverifikasi.
  Bukti: tidak diisi di kode; Docs menyatakan "Universal Router, Position Manager and Permit2 on RHC are not verified here"

## I7. Operasional dan kebersihan
- [x] CI GitHub Actions: install, build (sdk, zk, mcp), typecheck, `test:offline`, `cargo prove build`. Test live ditandai terpisah.
  Bukti: `.github/workflows/ci.yml`: job `node` (install, `pnpm build`, `pnpm typecheck`, `pnpm test`), `solidity` (`forge test`), `rust` (`cargo test` quote-rules), `live` (opt-in `workflow_dispatch`) · lokal: `pnpm -r typecheck` 5/5, `pnpm test` 61/61 + 7/7 · commit `f73f59b` · **`cargo prove build` belum dimasukkan** karena butuh toolchain SP1; ditambahkan saat H2 dikerjakan
- [x] Test Solidity (Foundry) untuk `ZGuardQuoteVerifier`.
  Bukti: `packages/zk/foundry/test/ZGuardQuoteVerifier.t.sol` · `forge test -vv` · 7/7 lulus · commit `f1f064d`
- [ ] 🟡 **timelock + two-step ownership ada di kontrak; multisig dan verifikasi Blockscout setelah deploy.** Multisig + timelock untuk owner verifier sebelum mainnet; verifikasi source di Blockscout.
- [ ] 🟡 Monitoring: RPC, Neon, kegagalan prover, alert saldo relayer.
  Status: `/health` (sequencer, storage) dan `/v1/metrics` (latensi, 5xx) tersedia sebagai sumber; alerting eksternal belum dipasang (butuh layanan monitoring user).
  **Update 2026-11-26: monitor terjadwal dibuat (kode ✅, aktivasi menunggu secret dari user).** `.github/workflows/monitor.yml` menjalankan `scripts/monitor.mjs` tiap 15 menit. Run yang gagal jadi merah dan GitHub mengirim email; opsional webhook Discord/Slack. Yang dicek:
  - `api_health`: `/health` 200, sequencer up, umur blok ≤ 300 dtk (memakai RPC + Neon).
  - `api_payment`: `payTo` valid, tidak ada settlement error.
  - `web_home`.
  - `perm_gate`: Perm `/api/zguard` `enforce` + `ready`; `off` = alert UNGUARDED.
  - `perm_credit`: kredit key Perm ≥ 5 panggilan guard. Karena gate fail-closed di mainnet, kredit habis berarti swap Perm berhenti.
  Bukti: `scripts/monitor.test.mjs` · `node --test scripts/monitor.test.mjs` · 7/7. Live dari sandbox: 4 cek ✅. Dengan key gratis (0,06 USDG) `perm_credit` ❌ "≈ 4 swaps left" → exit 1, dan webhook lokal menerima alert.
  Belum: alert kegagalan prover (ZK ditunda); saldo relayer tidak relevan (mode deposit, tanpa relayer).
- [ ] ⛔ Audit pihak ketiga sebelum mainnet. (keputusan bisnis, di luar repo)
- [x] Hapus `__MACOSX/` dari git dan tambah ke `.gitignore`; hapus salinan brief `dev-brief-zguard.md` di repo (satu sumber kebenaran).
  Bukti: commit `a82c9de` (`__MACOSX/`, `._*` di `.gitignore`; salinan brief dan lockfile npm liar dihapus)
- [x] Perbarui README: setiap ✅ harus menautkan bukti (tx hash, log, screenshot). Hapus yang belum terbukti.
  Bukti: `README.md` ditulis ulang: tabel status dengan kolom Evidence (file test/perintah), SP1 = scaffold, Halo2 = skeleton, Perm/Terminal = helper, MCP belum di npm, testnet-only · commit `aba2ded`

## I8. Cara kerja dan format laporan balik (tanpa PR)
Tidak perlu PR. Anak dev langsung mengerjakan di repo, lalu **mengupdate dokumen ini sendiri** sebagai laporan.

**Aturan update dokumen**
1. Setiap item yang dikerjakan: ubah `[ ]` menjadi `[x]` dan tambahkan satu baris bukti tepat di bawahnya, formatnya:
   `Bukti: <file/bagian yang diubah> · <perintah yang dijalankan> · <hasil singkat> · <tx hash / screenshot bila relevan>`
2. Bukti pengerjaan wajib menyebut **bagian mana** yang diubah (path file dan fungsi atau baris), bukan hanya "sudah beres".
3. PoC di Bagian J: setelah celah diperbaiki, balik assertion test PoC, ubah nama tanpa tag `[GAP]`, lalu catat hasil test di bawah temuannya.
4. Item yang menemukan masalah baru: tulis dengan pola 5 bagian (Masalahnya apa, Kenapa penting, Contoh kejadian, Cara memperbaiki, Bedanya setelah diperbaiki) dan sertakan PoC bernama `[ID] ...`.
5. Jangan menghapus temuan lama. Tandai statusnya (diperbaiki / belum / ditolak beserta alasan).

## I9. Alur testnet dan uji manual di web UI
Urutan wajib. Tiap tahap dicatat di dokumen ini.
1. **Deploy testnet:** deploy API dan web (Bagian I1), deploy verifier SP1 ke 46630 (Bagian H4). Catat URL, alamat kontrak, tx deploy.
2. **Konfigurasi web UI:** set `ZGUARD_INTERNAL_API_URL`, alamat verifier, RPC, pay-to, relayer di env deployment. Catat nama variabel yang diisi (tanpa nilai rahasia).
3. **Uji manual langsung di web live (testnet 46630):** jalankan semua alur dan tulis hasilnya di tabel di bawah. Pakai wallet asli (MetaMask/Rabby) dan wallet testnet ber-ETH dari faucet.
4. **Catat yang tidak jalan:** tiap kegagalan ditulis dengan langkah mengulang, hasil yang diharapkan, hasil nyata, dan screenshot.
5. **Beri tahu head dev** bahwa tabel sudah terisi. Head dev melakukan **deep analyze ulang** terhadap deployment dan kode terbaru, lalu memperbarui dokumen ini.

**Tabel uji manual web UI (isi oleh anak dev)**
| # | Alur yang diuji | Diharapkan | Hasil nyata (jalan / tidak jalan) | Catatan, screenshot, tx |
|---|---|---|---|---|
| 1 | Landing → Open Console → tombol Connect Wallet terlihat | Terlihat di navbar dan atas Console | **jalan (live, 2026-11-25)** | Kode: `WalletPill` (navbar) + `WalletStatusCard` (atas Console), commit `1fbfc06`; preview lokal tersedia |
| 2 | Connect Wallet (MetaMask/Rabby), pindah ke chain 46630 | Alamat tampil, tanpa popup tanda tangan | **jalan (live, wallet asli, 2026-11-25)**: hanya popup Connect + Switch network, alamat + Testnet 46630 tampil, reject ditangani wajar | Unit test wallet tiruan 7/7: hanya `eth_requestAccounts` + `wallet_switchEthereumChain(0xb626)` |
| 3 | Banner saat API mati | Tampil peringatan, tidak ada hasil palsu | jalan (build lokal) | Build `VERCEL=1` tanpa URL → `/v1/config` 503 → banner `api-offline-banner` + badge "API OFFLINE"; Console menulis "EXAMPLE FIXTURE (not a live verdict)" |
| 4 | Skenario: Matching USDG payment | allow, live, bukan fallback offline | **jalan (live zguard-delta.vercel.app, 2026-11-25)** | `check-console-scenarios.ts`: allow, kind=usdg, ~120–250 ms |
| 5 | Skenario: Active Pons curve scan | allow, `kind=pons_curve`, state curve terisi | **jalan (live zguard-delta.vercel.app, 2026-11-25)** | allow, kind=pons_curve |
| 6 | Skenario: Graduated Pons Uniswap v4 | allow, `kind=pons_graduated_v4` | **jalan (live zguard-delta.vercel.app, 2026-11-25)** | allow, kind=pons_graduated_v4 |
| 7 | Skenario: Spoofed Mock USDG | deny `T-MINT` | **jalan (live zguard-delta.vercel.app, 2026-11-25)** | deny `T-MINT, C-FINDING, T-LP` |
| 8 | Skenario: hidden approve() | deny `Q-006` / `S-APPROVE` | **jalan (live zguard-delta.vercel.app, 2026-11-25)** | deny `Q-006, S-APPROVE` |
| 9 | Skenario: undecodable bytes | abstain | **jalan (live zguard-delta.vercel.app, 2026-11-25)** | abstain `Q-DECODE, S-FAIL` |
| 10 | Token override dengan alamat nyata | Hasil token risk sesuai | **jalan (live, 2026-11-25)** | TSLA → allow `stock_token`; KOIP → allow `pons_curve`; Mock USDG → deny `T-MINT`, kind `other` |
| 11 | Sign Valid (Allow) dengan wallet asli | Popup wallet muncul, tanda tangan berhasil | **jalan (live, wallet asli, 2026-11-25)** | Tombol hanya muncul bila wallet terhubung di chain yang sama |
| 12 | Tamper payTo (Block) | Tidak ada popup, diblokir | **jalan (live, wallet asli, 2026-11-25)**: tidak ada popup, status deny | Logika signer dites: deny → 0 panggilan wallet (`c8-integrations.test.ts`) |
| 13 | Toggle Testnet/Mainnet (mainnet ditunda: cukup pastikan toggle tidak error) | Chain, skenario, dan tombol Connect ikut berubah | jalan (unit test) | Toggle = store bersama; saat terhubung meminta switch ke 0x1237; dites di `wallet.test.ts` |
| 14 | Halaman ZK: fixture allow dan deny Q-001 | Status `pending → proven → verified`, link `verifyTx` terbuka di explorer | sebagian: berhenti di `pending` (jujur) | allow → verdict allow / bitmask 0x0, deny → deny / 0x1; status `pending`, note "SP1 prover not configured". `verified` butuh prover + verifier (H2–H5) |
| 15 | RHC Registry: daftar Stock Token dan cek alamat | Data live, token ticker kembar tidak berlabel `stock_token` | **jalan (live, 2026-11-25)** | `/v1/registry` 5 stock token testnet; preset UI live; Mock USDG berlabel `other` |
| 16 | API & Pricing: register, balance, receipts | Register OK, receipts hanya milik tenant, tanpa key = 401 | **jalan (live API)** | register 200 + key `zg_live_…`; `/v1/receipts` tanpa key = 401; pendapatan global hanya muncul dengan `x-admin-key` (`poc-store.test.ts`) |
| 17 | Billing: panggilan berbayar sampai kredit habis | 402 dengan quote USDG di 46630; bayar nyata menambah kredit; bayar dari wallet kosong ditolak | **jalan (live, wallet asli, 2026-11-25)** | Panel Console "Buy credit · USDG": tx [`0x1aee4e73…4bf0`](https://explorer.testnet.chain.robinhood.com/tx/0x1aee4e73ef9b3194b58548cad3f826b134846507bee358a501f9d97ac7b14bf0) status success, `Transfer` 0.1 USDG `0x3d2f…e3Bf` → payTo `0x141D…86a8`; kredit 0.16 USDG (0.06 gratis + 0.10). Klaim tx yang sama oleh wallet lain → 402 "No USDG transfer from claim signer" (X402-4 live); tanpa `claimSignature` → 402; wallet 0 USDG → ditolak sebelum popup (pre-check saldo). Replay oleh pemilik: dites offline (`deposit.test.ts`) |
| 18 | Docs: contoh `curl` dan konfigurasi MCP | Berjalan apa adanya | **jalan setelah diperbaiki (2026-11-25)** | Sebelumnya TIDAK jalan: `pnpm add @zguard/sdk` dan `npx @zguard/mcp` = npm 404, fungsi `guard` tidak diekspor SDK, network mainnet 4663, curl berisi `{…}`. Sekarang: build dari repo, curl/SDK/MCP testnet 46630 dengan base URL = origin halaman; blok curl & SDK dijalankan persis seperti dirender → `allow`; MCP via `node packages/mcp/dist/index.js` → 5 tools, `tools/call` jalan ke API live |
| 19 | Tampilan mobile (navbar, Console, Docs) | Tidak ada layout rusak | **jalan (diuji user, 2026-11-25)** | Navbar, Console, Docs tanpa layout rusak |
| 20 | Fail-closed: matikan API atau RPC | Hasil bukan allow, signer menolak | jalan (lokal) | API tidak terkonfigurasi → 503 `abstain P-UNAVAIL`; signer menolak non-allow (`c8-integrations`, acceptance §9.4) |

**Log temuan dari uji manual (isi oleh anak dev, pola 5 bagian)**
> **Live 2026-11-25:** `ZGUARD_BASE_URL=https://zguard-delta.vercel.app tsx apps/web/scripts/check-console-scenarios.ts` → 6/6 PASS (236–864 ms); `/v1/metrics` p95 `POST /v1/guard` = 500 ms di Vercel. Baris 1–2 diuji user dengan wallet asli.

**[PAYTO-CONFIG] `ZGUARD_X402_PAY_TO` tidak divalidasi** (ditemukan saat konfigurasi deploy)
- *Masalahnya apa:* server menerima nilai apa pun sebagai alamat treasury dan menampilkannya di `/v1/config` dan quote 402.
- *Kenapa penting:* salah tempel (misalnya kunci rahasia 64 hex) langsung terlihat publik, dan klien bisa diarahkan membayar ke alamat yang tidak valid.
- *Contoh kejadian:* `payTo` live sempat berisi string 64 hex tanpa `0x`; kunci terkait sudah dirotasi.
- *Cara memperbaiki:* `resolvePayTo` di `config.ts` memvalidasi `0x` + 40 hex; nilai salah atau kosong di produksi → pembayaran ditolak, `payTo: null`, `accepts: []`, nilai tidak pernah ditampilkan.
- *Bedanya setelah diperbaiki:* `payto-config.test.ts` 2/2; live `payTo` = alamat EOA yang valid. Commit `9f7cbc5` (remote).

> Kolom "jalan (lokal)" diuji di stack lokal (web `next start` → API → RPC publik RHC 46630), bukan di zguard-delta.vercel.app, karena deploy menunggu user. Tabel ini wajib diulang di web live dengan wallet asli.

**[C8-BUG] Helper Perm/Terminal tidak pernah bisa menandatangani** (ditemukan saat menulis test C8)
- *Masalahnya apa:* `createPermRouterGuard`/`createTerminalSwapGuard` mengirim payload `type:"evm_tx"` ke guard, sedangkan `guardEvmSigner` meng-hash `{type:"intent", tx, intent}`.
- *Kenapa penting:* `payload_hash` tidak pernah cocok, jadi helper selalu menolak, termasuk saat `allow`. Integrator akan mematikan guard karena dianggap rusak.
- *Contoh kejadian:* rute valid → guard `allow` → signer melempar `GuardBlockedError` (hash mismatch).
- *Cara memperbaiki:* helper mengirim payload yang sama persis dengan yang diverifikasi signer.
- *Bedanya setelah diperbaiki:* allow → tepat 1 `sendTransaction`; deny/abstain/disabled → 0. PoC/regresi `c8-integrations.test.ts` 5/5, commit `0d6f9b8`.

**Hasil deep analyze ulang (diisi head dev setelah tabel terisi)**
<!-- diisi head dev -->

---

> **Keputusan user 2026-11-26: ZK SP1 ditunda.** Attestation tetap `pending` (berlabel jujur di UI, API, README). Catatan teknis untuk saat dilanjutkan:
> 1. Gateway SP1 Succinct (`0x397A…dA9B` groth16, `0x3B60…185e` plonk) **tidak ada** di RHC 46630 → verifier `SP1VerifierGroth16` harus di-deploy sendiri (CREATE2 deployer `0x4e59…956C` tersedia).
> 2. Succinct Prover Network kini butuh `sp1-sdk >= 6.1` dan pembayaran token PROVE (Ethereum mainnet); guest masih `sp1-zkvm 4.1.0` → perlu upgrade guest + verifier ke v6.
> 3. `proveQuoteAttestationAsync` memanggil prover sinkron dengan timeout 30 dtk; proof Groth16 butuh menit → perlu prover service async (job + polling) yang di-host di luar Vercel.

# BAGIAN J: Hasil deep pass jalur prioritas (quote-match, x402, store), 2026-11-25
> **Yang dibaca penuh:** `quote-match.ts` (913 baris), `x402.ts` (bagian verifikasi dan settlement), `store.ts` (charge, nonce, receipts), route `/v1/receipts` dan `/v1/attestation`.
> **Bukti:** 9 PoC lokal di `apps/api/test/poc-*.test.ts`. Aturan PoC: **test yang LULUS berarti celahnya ADA.** Setelah diperbaiki, balik assertion-nya dan ubah nama tanpa tag `[GAP]`. Semua PoC hanya lokal (belum di-commit).
> Perintah: `cd apps/api && npx tsx --test test/poc-quote-match.test.ts test/poc-x402.test.ts test/poc-store.test.ts`
> **Catatan lapisan:** PoC QM menguji cek quote-match saja. Di `/v1/guard` cek simulasi mungkin menangkap sebagian (misal `S-DIFF`), tetapi cek quote tidak boleh bergantung pada itu.
> **Belum dibaca di jalur ini:** `token-risk.ts`, `simulate.ts`, `url-scanner.ts`, MCP, signer, content-scan (tetap di Bagian I5).

## Ringkasan
| # | Temuan | Seberapa serius | Bukti |
|---|---|---|---|
| X402-1 | Kredit gratis tanpa bayar (mode default `auto` tanpa relayer) | 🔴 Kritis | PoC `[X402-1]` |
| X402-2 | Settlement onchain gagal tetap memberi kredit (mode `auto`) | 🔴 Kritis | PoC `[X402-2]` |
| QM-1 | Intent dengan fungsi yang tidak bisa di-encode meloloskan calldata apa pun | 🔴 Tinggi | PoC `[QM-1]` |
| STORE-1 | `/v1/receipts` tanpa API key membocorkan receipt semua tenant dan pendapatan global | 🔴 Tinggi | PoC `[STORE-1]` |
| QM-3 | `allowApprovals` apa pun mematikan semua cek approval | 🟠 Tinggi | PoC `[QM-3]` |
| QM-2 | Intent tanpa `tx` dibandingkan dengan dirinya sendiri → `allow` | 🟠 Sedang | PoC `[QM-2]` |
| QM-4 | EIP-3009 tanpa `domain` tidak terikat kontrak/chain | 🟠 Sedang | PoC `[QM-4]` |
| QM-5 | Daftar selector approval tidak lengkap (ERC-777 dll.) | 🟡 Sedang | PoC `[QM-5]` |
| X402-4 | Klaim kredit lewat `txHash` tidak terikat ke pembayar | 🟠 Sedang | dari kode |
| QM-6 | Registri domain EIP-712 statis di kode, bukan dibaca dari chain saat jalan | 🟡 Sedang | dari kode |
| QM-7 | Jalur ERC-20 `evm_tx` mengabaikan `value` ETH | 🟡 Rendah | dari kode |

## X402-1. Kredit gratis dari wallet kosong 🔴 · *terbukti (PoC [X402-1])*
> **Status: ✅ diperbaiki.** Kredit hanya dari settlement onchain sukses (receipt + `ZGUARD_X402_MIN_CONFIRMATIONS`) atau dari deposit yang terikat ke pembayar; `offchain` ditolak saat produksi. Bukti: `x402.ts` `resolveSettlementMode` / `settleEip3009Onchain` · `poc-x402.test.ts` (PoC dibalik `[FIXED]`) lulus · commit `f9513ac`

**Masalahnya apa**
`verifyAndConsumeXPayment` (`x402.ts`) hanya memeriksa tanda tangan EIP-3009 secara offline. Settlement onchain `settleEip3009OnchainIfConfigured` mengembalikan `ok: true` tanpa mengirim apa pun bila mode bukan `onchain` dan tidak ada relayer key (default `.env.example`: `auto`, relayer kosong). Kredit langsung dicatat sebesar `value` pada tanda tangan. Tidak ada pengecekan saldo `from`.

**Kenapa penting**
Seluruh model pendapatan (bayar per panggilan, buyback/burn) bisa dilewati. Test §9.7 repo sendiri lulus memakai kunci hardcoded yang kemungkinan besar tanpa saldo, jadi test itu justru menunjukkan celah ini.

**Contoh kejadian**
Penyerang membuat kunci baru (saldo 0), menandatangani otorisasi $5 ke alamat treasury, mengirim `POST /v1/register` dengan header `X-PAYMENT`. Respons: `creditMicroUsdg: 5000000`. Uang tidak pernah berpindah.

**Cara memperbaiki**
1. Kredit hanya diberikan setelah `transferWithAuthorization` benar-benar sukses onchain (receipt `success`) atau setelah cek saldo + `authorizationState` terbukti, dan tx settlement tercatat.
2. Mode produksi wajib `onchain`; start gagal bila relayer key kosong. Mode `offchain`/`simulate` hanya untuk dev dan harus ditolak bila `NODE_ENV=production`.
3. Ubah test §9.7: pakai wallet tanpa saldo dan pastikan 402; tambahkan test dengan saldo cukup di testnet.

**Bedanya setelah diperbaiki**
Kredit sama dengan uang yang benar-benar masuk ke treasury.

## X402-2. Settlement gagal, kredit tetap diberikan 🔴 · *terbukti (PoC [X402-2])*
> **Status: ✅ diperbaiki.** Semua jalur `catch` menolak dan nonce tidak dikonsumsi. Bukti: `x402.ts` `settleEip3009Onchain` · `[X402-2][FIXED]` lulus · commit `f9513ac`

**Masalahnya apa**
Pada blok `catch` settlement, hanya mode `onchain` yang mengembalikan error. Mode `auto` mengembalikan `ok: true` bila `writeContract` melempar error (saldo kurang, RPC mati, revert saat estimasi gas), meski relayer key sudah diisi.

**Kenapa penting / Contoh kejadian**
Sama dengan X402-1, tetapi bahkan operator yang sudah memasang relayer tetap rugi: otorisasi dari wallet kosong menghasilkan kredit penuh.

**Cara memperbaiki**
Hapus cabang "return ok: true" di `catch`. Semua kegagalan settlement = tolak (402/abstain) dan jangan catat nonce sebagai terpakai.

**Bedanya setelah diperbaiki**
`[X402-3]` (mode `onchain` menolak) menjadi perilaku semua mode produksi.

## QM-1. Calldata apa pun lolos bila fungsi intent tidak bisa di-encode 🔴 · *terbukti (PoC [QM-1], [QM-5])*
> **Status: ✅ diperbaiki.** Gagal re-encode → `abstain Q-DECODE`. Bukti: `quote-match.ts` jalur intent · `[QM-1][FIXED]` lulus · commit `de7fa0e`

**Masalahnya apa**
Di jalur `intent` (`quote-match.ts` sekitar baris 653-679), jika `encodeIntentCalldata` gagal (nama fungsi seperti `"swap"` tanpa ABI/signature) hasilnya `null`. Kode lalu hanya memeriksa bentuk hex calldata; **tidak ada pencocokan** dengan intent. Satu-satunya penjaga adalah daftar 7 selector approval.

**Kenapa penting**
Kesamaan antara intent (disusun router) dan tx (yang ditandatangani) adalah janji utama ZGuard. Di sini cek itu kosong.

**Contoh kejadian**
Intent `{to: USDG, function: "swap"}` dengan tx `{to: USDG, data: transfer(attacker, 1e12)}` menghasilkan `allow` di cek quote. Hal yang sama untuk `authorizeOperator` (QM-5).

**Cara memperbaiki**
Bila calldata tidak bisa di-re-encode dari intent, hasilkan `abstain` (`Q-DECODE`), bukan lanjut. Wajibkan `intent.abi` atau signature lengkap; tolak nama fungsi telanjang di luar daftar yang dikenal.

**Bedanya setelah diperbaiki**
Intent yang tidak bisa dibuktikan identik dengan tx tidak pernah menjadi `allow`.

## STORE-1. `/v1/receipts` membocorkan data semua tenant 🔴 · *terbukti (PoC [STORE-1])*
> **Status: ✅ diperbaiki.** Bukti: `app.ts` route `/v1/receipts` (401 tanpa key; global hanya `x-admin-key`) · `poc-store.test.ts` `[FIXED]` lulus · lokal `curl /v1/receipts` = 401 · commit `9d586ad`

**Masalahnya apa**
`GET /v1/receipts` tanpa header API key memakai `tenantId = null`, dan `listReceipts(null)` tidak memfilter. Hasilnya receipt terbaru semua tenant (alamat penerima, jumlah, token, hasil cek) ditambah `getRevenueSummary()` global.

**Kenapa penting**
Kebocoran data pelanggan dan pendapatan tanpa autentikasi.

**Contoh kejadian**
`curl https://<api>/v1/receipts` mengembalikan receipt tenant lain.

**Cara memperbaiki**
Wajibkan API key (401 tanpa key). Ringkasan pendapatan global hanya untuk admin. Tambah test isolasi antar tenant.

**Bedanya setelah diperbaiki**
Tiap tenant hanya melihat receipt miliknya.

## QM-3. `allowApprovals` apa pun mematikan cek approval 🟠 · *terbukti (PoC [QM-3])*
> **Status: ✅ diperbaiki.** `approvalMatchesAllowList` (token, spender, jumlah ≤ max) di `packages/sdk/src/approvals.ts`/`quote-match.ts` · `[QM-3][FIXED]`, `[QM-3b]` lulus · commit `de7fa0e`

`isExplicitApprovalIntent` hanya mengecek `allowApprovals.length > 0`. Spender dan `maxAmount` yang dideklarasikan tidak pernah dicocokkan dengan approve yang benar-benar ditandatangani. **Perbaikan:** decode `approve`/`permit` pada calldata dan wajibkan spender, token, dan jumlah ≤ `maxAmount` cocok dengan salah satu entri; selain itu `Q-006`.

## QM-2. Intent tanpa `tx` dibandingkan dengan dirinya sendiri 🟠 · *terbukti (PoC [QM-2])*
> **Status: ✅ diperbaiki (bukan lagi "desain").** Intent tanpa `tx` → `abstain Q-DECODE`; `guardPermRoute` mewajibkan `tx`; skenario intent di Console kini membawa `tx` eksak. Bukti: `[QM-2][FIXED]` lulus · skenario Console 6/6 · commit `de7fa0e`, `1fbfc06`

Tanpa `payload.tx`, `actual = expected` sehingga hasilnya `allow` tanpa membandingkan apa pun. **Perbaikan:** intent tanpa tx atau typed data yang bisa dibandingkan = `abstain` (`Q-DECODE`) atau `deny` (`Q-005`).

## QM-4. EIP-3009 tanpa `domain` 🟠 · *terbukti (PoC [QM-4])*
> **Status: ✅ diperbaiki.** Tanpa `domain.chainId` + `verifyingContract` → `abstain Q-007`. Bukti: `[QM-4][FIXED]` lulus · commit `de7fa0e`

Bila `authorization.domain` kosong, aset dan chainId diisi dari quote dan network, sehingga Q-003/Q-004 tidak pernah muncul dan tidak ada ikatan ke kontrak mana yang akan dipanggil tanda tangan. **Perbaikan:** `domain` wajib; kosong = `abstain`. Di jalur signer, ambil domain dari typed data yang benar-benar ditandatangani.

## Catatan lain
> **Status tabel ini (2026-11-25):** X402-4 ✅ (`claimSignature`, commit `f9513ac`) · kedalaman konfirmasi ✅ (`ZGUARD_X402_MIN_CONFIRMATIONS`, default 3) · QM-6 ✅ (domain dibaca dari `DOMAIN_SEPARATOR()` saat start, beda → `Q-007`, commit `5b0c52e`) · QM-7 ✅ (`value` ETH pada ERC-20 ditolak) · selector + multicall/execute rekursif ✅ (`approvals.ts`) · flag Solana ✅ (dihitung dari instruksi ter-decode, `solana-decode.ts`) · semua di commit `de7fa0e` dan dites di `poc-quote-match.test.ts`.

| Temuan | Kenapa disebut | Perbaikan |
|---|---|---|
| X402-4: Path txHash menghitung semua log `Transfer` ke treasury dan memberi kredit ke pengklaim pertama | Siapa pun yang melihat tx publik bisa mengklaim lebih dulu deposit orang lain | Ikat klaim ke pembayar (tanda tangan pesan klaim dari `from`) atau memo/ID tenant di tx |
| X402: tidak ada kedalaman konfirmasi untuk txHash | Risiko reorg kecil di L2 | Tunggu N blok atau status finalized |
| QM-6: `getVerifiedEip712Domain` membaca registri statis di memori | Brief §6.1.4: domain dibaca dari kontrak terpasang | Isi registri saat start dari `DOMAIN_SEPARATOR()` onchain dan cocokkan dengan konstanta, gagal bila beda |
| QM-7: Jalur ERC-20 `evm_tx` tidak memeriksa `value` ETH | Tx bisa mengirim ETH tambahan ke kontrak | Tolak `value != 0` pada panggilan ERC-20 |
| Daftar selector approval hanya 7 entri, tidak memindai multicall/execute | Approve bisa dibungkus | Decode rekursif multicall; tambah `approveAndCall`, `authorizeOperator`, `safeIncreaseAllowance` |
| Flag Solana (`hasApproveOrSetAuthority`) diisi pemanggil | Pemanggil bisa mematikan Q-006 | Hitung dari instruksi yang di-decode |

## Yang sudah bagus (hasil pembacaan ini) ✅
- `chargeCredit` versi Neon atomik (`UPDATE ... WHERE credit >= cost`), tidak bisa minus atau dobel potong.
- `consumePaymentNonce` versi Neon memakai `ON CONFLICT DO NOTHING`, replay nonce diblokir atomik.
- API key disimpan sebagai hash SHA-256.
- Alamat dibandingkan dalam huruf kecil (tidak bisa dibypass checksum), jumlah memakai BigInt.
- Q-001..Q-004 untuk EIP-3009 dan `evm_tx` benar bila `domain`/tx lengkap; approval langsung di jalur `evm_tx` ditolak.
- Cek `to == treasury`, `validBefore`, `validAfter`, dan `authorizationState` onchain ada.

## Tugas tambahan untuk anak dev (prioritas urut)
- [x] **P0:** perbaiki X402-1 dan X402-2 (kredit hanya setelah settlement sukses; mode produksi wajib `onchain`); ubah test §9.7.
  Bukti: `x402.ts` · `cd apps/api && tsx --test test/offline.test.ts test/poc-*.test.ts test/deposit.test.ts test/zk-honesty.test.ts test/c8-integrations.test.ts` · 61/61 lulus · produksi menerima `onchain` atau `deposit`; keduanya hanya mengkredit uang yang benar-benar pindah · commit `f9513ac`, `53acd7a`
- [x] **P0:** perbaiki STORE-1 (`/v1/receipts` wajib API key; pendapatan global hanya admin) + test isolasi.
  Bukti: `app.ts` `/v1/receipts`, `isAdmin()` (~173) · `poc-store.test.ts` lulus · commit `9d586ad`
- [x] **P0:** perbaiki QM-1 (re-encode gagal = `abstain`), QM-2, QM-3, QM-4 + balik assertion PoC jadi test regresi.
  Bukti: `quote-match.ts`, `approvals.ts` · `poc-quote-match.test.ts` (tag `[FIXED]`) lulus · commit `de7fa0e`
- [x] **P1:** QM-5/QM-7 + selector dan multicall; X402-4; QM-6.
  Bukti: `approvals.ts` (selector tambahan + decode rekursif multicall/execute), `quote-match.ts` (QM-7), `x402.ts` (X402-4), `packages/sdk/src/eip712.ts` + `apps/api/src/services/rhc-rpc.ts` + startup di `app.ts` (QM-6) · test lulus · commit `de7fa0e`, `f9513ac`, `5b0c52e`
- [x] Setelah semua PoC dibalik menjadi hijau (aman), jalankan ulang seluruh suite live.
  Bukti: `tsx --test test/testnet-46630.test.ts` 10/10 · `test/acceptance.test.ts` (baca-saja 4663) 10/10 · sesi 2026-11-25


---

# BAGIAN K: Status perbaikan P0 dari Bagian J (dikerjakan head dev, lokal, belum di-commit)
> Semua perbaikan ada di working tree repo clone. Anak dev: tinjau, lanjutkan, dan lakukan uji testnet (I9). Hasil suite live ditulis di bawah setelah selesai.

| Temuan | Status | Bagian yang diubah | Bukti |
|---|---|---|---|
| X402-1 kredit tanpa uang | ✅ diperbaiki | `apps/api/src/services/x402.ts`, fungsi `settleEip3009OnchainIfConfigured`: tanpa relayer = tolak; mode `offchain` hanya dev dan ditolak saat `NODE_ENV=production` | Test `[X402-1][FIXED]`, `[X402-4]`, `[X402-5]` lulus |
| X402-2 settlement gagal tetap kredit | ✅ diperbaiki | `x402.ts`, blok `catch`: selalu tolak | Test `[X402-2][FIXED]` lulus |
| STORE-1 `/v1/receipts` bocor | ✅ diperbaiki | `apps/api/src/app.ts` route `/v1/receipts`: API key wajib (401), hanya receipt milik tenant, pendapatan global hanya dengan `x-admin-key` (config baru `ZGUARD_ADMIN_API_KEY`), non-admin hanya lihat total miliknya | Test `[STORE-1][FIXED]` lulus (anonim 401, tenant lain tidak melihat receipt korban) |
| QM-1 calldata lolos bila tidak bisa di-encode | ✅ diperbaiki | `packages/sdk/src/quote-match.ts`, jalur intent: gagal re-encode = `abstain` `Q-DECODE` | Test `[QM-1][FIXED]` lulus |
| QM-3 `allowApprovals` jadi pass buta | ✅ diperbaiki | `quote-match.ts`, fungsi baru `approvalMatchesAllowList`: token, spender, jumlah harus cocok | Test `[QM-3][FIXED]` dan `[QM-3b]` lulus |
| QM-4 EIP-3009 tanpa domain | ✅ diperbaiki | `quote-match.ts`, jalur eip3009: tanpa `domain.chainId` + `verifyingContract` = `abstain` `Q-007` | Test `[QM-4][FIXED]` lulus |
| QM-5 selector approval kurang | ✅ selesai (update: decode multicall/execute rekursif ditambahkan, `approvals.ts`, commit `de7fa0e`) — semula: sebagian | `quote-match.ts`: ditambah `0x959b8c3f`, `0xcae9ca51`, `0xd73dd623`. Belum: decode multicall/execute rekursif | Test `[QM-5][FIXED]` lulus |
| QM-2 intent tanpa tx | ✅ diperbaiki (update: tanpa `tx` → `abstain Q-DECODE`, commit `de7fa0e`) — semula: ⚪ ditandai desain | Tidak diubah: simulasi memakai intent itu sendiri. **Syarat:** signer wajib mengikat `payload_hash` ke apa yang benar-benar ditandatangani. Anak dev: verifikasi di `signer.ts` | Test `[QM-2][DESIGN]` |
| X402-4 klaim txHash tidak terikat pembayar, QM-6, QM-7, flag Solana | ✅ semua diperbaiki (update 2026-11-25: commit `f9513ac`, `5b0c52e`, `de7fa0e`) — semula: ❌ belum | Masih di daftar Bagian J | |

**Test regresi (file `apps/api/test/`):** `poc-quote-match.test.ts`, `poc-x402.test.ts`, `poc-store.test.ts`, `offline.test.ts`. Hasil saat ini: 16 dari 16 lulus. Jalankan: `cd apps/api && npx tsx --test test/poc-*.test.ts test/offline.test.ts`.

**Perubahan perilaku yang perlu diketahui anak dev**
- Env produksi wajib punya `ZGUARD_X402_RELAYER_PRIVATE_KEY` dan wallet relayer ber-ETH, kalau tidak semua pembayaran X-PAYMENT ditolak.
- Test §9.7 di `acceptance.test.ts` sekarang memakai `ZGUARD_X402_SETTLEMENT_MODE=offchain` (dev saja). **Tugas:** tambah test testnet dengan settlement onchain sungguhan dari wallet ber-saldo, dan test bahwa wallet kosong ditolak.
- Klien yang memakai intent dengan nama fungsi telanjang (misal `"swap"`) kini mendapat `abstain` bila menyertakan `tx`. Router/terminal harus mengirim `intent.abi` atau signature lengkap.
- Web ApiPage (ledger) sekarang butuh API key (hasil register); tanpa key mendapat 401.

## Hasil suite setelah perbaikan P0 (2026-11-25)
| Suite | Hasil | Catatan |
|---|---|---|
| Typecheck 5 proyek | Lulus | |
| Test regresi lokal (`poc-*`, `offline`) | 16/16 lulus | |
| Live testnet 46630 (10 test) | **10/10 lulus** | Termasuk §9.5 allow/deny, §9.10, registry |
| Live mainnet 4663 (10 test) | **6/10 lulus, 4 gagal** | Yang gagal: §9.2, §9.3, §9.5, §9.10. **Penyebab terdeteksi: lingkungan, bukan kode.** `rpc.mainnet.chain.robinhood.com` mengembalikan `ENOTFOUND` (DNS) dari mesin ini pada saat dicek, sementara testnet 200. Sebelum perbaikan, 10/10 mainnet lulus di sesi yang sama |

**Tugas anak dev:** jalankan ulang `pnpm --filter @zguard/api test:live` saat RPC mainnet bisa dijangkau dan tulis hasil 20/20 di sini.
> **Hasil (2026-11-25):** RPC mainnet terjangkau → testnet 10/10 + acceptance (baca-saja 4663) 10/10 = **20/20**. Bila ada yang masih gagal, tulis nama test dan pesan error (kemungkinan terkait perubahan QM-1/QM-4 pada fixture mainnet).

## Update: mode `deposit` (tanpa relayer) dan penutupan X402-4
| Hal | Status | Bagian yang diubah | Bukti |
|---|---|---|---|
| Mode `ZGUARD_X402_SETTLEMENT_MODE=deposit` | ✅ | `apps/api/src/config.ts` (nilai baru), `x402.ts` (otorisasi EIP-3009 ditolak di mode ini; kredit hanya dari transfer USDG milik pembayar) | `test/deposit.test.ts` 6/6 lulus |
| X402-4 klaim txHash tidak terikat pembayar | ✅ diperbaiki untuk semua mode | `x402.ts`: klaim wajib `claimSignature` (EIP-191 atas `depositClaimMessage(txHash, chainId)`), kredit hanya dari transfer `from = penanda tangan` ke treasury | Test `[X402-4][FIXED]`: pencuri yang menyalin txHash ditolak |

**Cara pakai klien (mode deposit):** (1) transfer USDG ke `ZGUARD_X402_PAY_TO`, (2) tandatangani pesan `ZGuard credit claim\ntx:<txHash huruf kecil>\nchain:<chainId>` dengan wallet yang sama, (3) kirim `X-PAYMENT` berisi `{"network":"eip155:4663","payload":{"txHash":"0x…","claimSignature":"0x…"}}`.

**Tugas anak dev:** (a) uji dengan transfer USDG nyata di testnet 46630 (pakai faucet), termasuk replay dan pencuri; (b) tambahkan kedalaman konfirmasi sebelum kredit; (c) perbarui halaman Docs dan quote 402 agar menjelaskan alur deposit; (d) jalankan `pnpm --filter @zguard/api test:offline`.
> **Status:** (a) ⛔ butuh USDG faucet + wallet (logika dites offline di `deposit.test.ts`); (b) ✅ `ZGUARD_X402_MIN_CONFIRMATIONS` (default 3); (c) ✅ Docs bagian billing (commit `e2c8326`) + quote 402 memuat `settlement.mode`/`instructions`/`minConfirmations`; (d) ✅ `pnpm --filter @zguard/api test:offline` 61/61.

## Klarifikasi: apa arti "mainnet" di hasil test
- **ZGuard belum punya kontrak atau deployment sendiri di mainnet maupun testnet.** `ZGUARD_ZK_VERIFIER_ADDRESS` kosong dan tidak ada tx deploy.
- Test "mainnet 4663" hanya **membaca** Robinhood Chain mainnet yang publik (`rpc.mainnet.chain.robinhood.com`) memakai kode ZGuard. Tidak ada transaksi yang dikirim dan tidak ada uang yang berpindah.
- Yang dibaca adalah **proyek pihak lain di chain itu**: USDG resmi Paxos/Robinhood, registri Stock Token Robinhood, dan token Pons. Sampel "graduated" di test, `0x3bA500F1…c09D`, adalah **token $WORM milik Agent Wormhole**, yaitu referensi kompetitor di brief. Sampel curve `0x0581…1214` juga token pihak lain.
- Jadi hasil mainnet menunjukkan "kode ZGuard bisa menganalisis chain asli", bukan "ZGuard sudah live di mainnet".
- Default aplikasi tetap testnet 46630. Mainnet baru boleh dianggap siap setelah deploy sendiri, multisig, dan audit (Bagian I7).

## Update: alamat $WORM milik Agent Wormhole dihapus dari kode
| Bagian yang diubah | Perubahan |
|---|---|
| `apps/web/src/views/RegistryPage.tsx` | Konstanta `MAINNET_PONS_GRAD` (`0x3bA500F1…c09D`, $WORM) dan preset "pons graduated v4" di mainnet dihapus. Preset testnet (PONSIDOOG) tetap |
| `apps/api/test/acceptance.test.ts` | `PONS_GRADUATED_SAMPLE` kini dibaca dari env `ZGUARD_TEST_PONS_GRADUATED_TOKEN`. Kosong = asersi `pons_graduated_v4` di mainnet dilewati |
| Hasil | `grep` untuk `3bA500F1` di `apps/` dan `packages/` kosong. Typecheck api dan web lulus |
| Update 2026-11-25 | Referensi "$WORM" juga dihapus dari `DocsPage.tsx`; `grep -rn "3bA500\|WORM"` di kode = kosong · commit `6dc9a62` |

**Tugas anak dev**
- [ ] ⛔ (menunggu token ZGuard) Setelah token ZGuard sendiri diluncurkan di Pons dan graduate, isi `ZGUARD_TEST_PONS_GRADUATED_TOKEN` dengan alamat itu agar test mainnet mencakup 5 jenis token.
- [ ] ⛔ (butuh launch token sendiri di Pons testnet) Sampel lain yang masih milik pihak lain: curve `0x0581…1214` (mainnet, dipakai di test dan preset web) serta KOIP dan PONSIDOOG (testnet). Ganti dengan token buatan sendiri di testnet (launch via Pons testnet) bila memungkinkan.
- [ ] ⛔ (alamat milik user) Isi `ZGUARD_PONS_TOKEN_ADDRESS`, `ZGUARD_BUYBACK_WALLET` dengan alamat milik ZGuard (brief §10). Jangan memakai alamat buyback, burn, atau multisig milik Wormhole.
- Referensi $WORM di brief (`dev-brief-zguard.md`) dibiarkan karena itu dokumen riset, bukan kode.


---

# BAGIAN L: Keputusan head dev (2026-11-25)
1. **Semua perubahan tetap lokal.** Tidak ada push ke `wealthy-org/ZGuard`. Perubahan ada di working tree `BRAINSTROMING/zguard/repo` (belum di-commit). Serah-terima ke anak dev lewat dokumen ini; kode diberikan atas perintah head dev.
2. **Mainnet ditunda.** Fokus penuh di **testnet 46630** sampai semua hijau: deploy, konfigurasi web, uji manual 20 alur (I9), zk SP1 terverifikasi (Bagian H), dan deep analyze ulang. Integrasi mainnet baru dimulai setelah itu.
3. **Dampak ke tugas:**
   - Item bertanda ⏸ di Bagian I ditunda.
   - Test live mainnet (6/10 lulus, 4 gagal karena DNS RPC saat dicek) **tidak dikejar sekarang**. Gerbang kualitas saat ini: `test:offline` dan live testnet 46630.
   - Default aplikasi tetap testnet 46630. Jangan deploy kontrak, mengisi relayer berisi dana, atau menayangkan klaim apa pun di mainnet.
   - Bagian I6 (verifikasi onchain) tetap dikerjakan untuk testnet; pembacaan mainnet bersifat opsional dan hanya baca.
4. **Syarat masuk fase mainnet** (semua harus terpenuhi): uji manual testnet 20/20 jalan, zk `verifyTx` testnet ada, P0 Bagian J hijau, deep analyze ulang tanpa temuan kritis, CI hidup, multisig dan treasury siap, audit pihak ketiga dijadwalkan (Bagian I7).

---

# BAGIAN M: Laporan putaran penutupan gap (anak dev, 2026-11-25)

## M1. Ringkasan status
| Kelompok | Tertutup di kode | Masih terbuka | Penyebab sisa |
|---|---|---|---|
| Keamanan inti (C4, C5, C6, STORE-1, X402-1/2/4, QM-1…7, Solana) | Semua | — | — |
| zk (C1, B3, C2) | C1, B3, bagian C2 tanpa infra (crate aturan, guest scaffold, status jujur) | `cargo prove build`, vkey, proof, deploy verifier, `verifyTx` | Butuh toolchain SP1, prover network, wallet deploy |
| Live (C3) | Fallback 503 (tanpa loop) + proxy aman | Deploy API + env web + redeploy | Akses Vercel user |
| Web (D2, D3, banner, badge, Docs, $WORM) | Semua | Uji wallet asli dan mobile | Butuh browser + wallet |
| Integrasi (C8) | Helper diperbaiki + test guard-off | PR ke repo Perm/terminal | Akses repo pihak lain |
| Ops (CI, test script, README, .env, onchain I6) | Semua | Monitoring/alert, audit, multisig | Layanan dan keputusan operator |
| Mainnet (C7, item ⏸) | — | Ditunda | Keputusan head dev (Bagian L) |

## M2. Hasil test (semua dijalankan 2026-11-25)
| Suite | Perintah | Hasil |
|---|---|---|
| Offline API + SDK + zk-honesty + C8 | `pnpm test` (atau `pnpm --filter @zguard/api test:offline`) | 61/61 |
| Web wallet store (D3) | `pnpm --filter @zguard/web test` | 7/7 |
| Typecheck 5 proyek | `pnpm typecheck` | lulus |
| Foundry verifier | `pnpm test:sol` | 7/7 |
| Rust quote-rules | `pnpm test:rust` | 5/5 |
| Live testnet 46630 | `pnpm test:live` (bagian testnet) | 10/10 |
| Live acceptance (baca-saja 4663) | `pnpm test:live` (bagian acceptance) | 10/10 |
| Skenario Console lewat web proxy → RHC 46630 | `cd apps/web && tsx scripts/check-console-scenarios.ts` | 6/6 |
| C4 melawan kode lama | lihat I2 | gagal 2/2 di kode lama, lulus di kode baru |
| C3 build `VERCEL=1` tanpa URL | `next build` + `curl` | 503 `misconfigured`, tanpa `Location` |

## M3. Commit (main lokal, di atas `fd0dfa3`, belum di-push)
`a82c9de` cleanup · `638c75a` C4 · `f9513ac` x402/deposit · `9d586ad` store/ops/CORS/rate-limit/metrics · `2eb4391` test offline · `5b0c52e` QM-6 · `de7fa0e` QM-1…7 + Solana · `f1f064d` zk C1/B3 · `375ff65` quote-rules + guest (C2) · `53acd7a` live tests · `665acc2` schema rate-limit · `0d6f9b8` C8 · `2bbda39` C3 · `807a182` CORS vercel.json · `1fbfc06` D3 + banner + tx skenario · `56e69cf` D2 ZK jujur · `6dc9a62` $WORM · `7f57ee0` script test · `f73f59b` CI · `a857327` .env.example · `aba2ded` README · `309fec6` copy ZK web · `d95750b` skrip skenario · `e2c8326` Docs billing · `6a90158` Perm/terminal copy

## M4. Yang harus dilakukan user / operator (tidak bisa dari repo)
1. **Push** `main` ke `wealthy-org/ZGuard` (CI akan berjalan otomatis).
2. **Vercel proyek API** (root `apps/api`): `ZGUARD_ACTIVE_CHAIN_ID=46630`, `DATABASE_URL` (Neon), `ZGUARD_X402_PAY_TO`, `ZGUARD_ADMIN_API_KEY` (≥16 karakter), `ZGUARD_CORS_ORIGINS=https://zguard-delta.vercel.app`, `ZGUARD_DEV_FREE_CREDIT_MICRO_USDG=0`, `ZGUARD_X402_SETTLEMENT_MODE=deposit` (atau `onchain` + `ZGUARD_X402_RELAYER_PRIVATE_KEY`). Lalu jalankan `pnpm db:push` sekali.
3. **Vercel proyek web** (root `apps/web`): `ZGUARD_INTERNAL_API_URL=https://<proyek-api>.vercel.app`, lalu redeploy. Cek `curl https://zguard-delta.vercel.app/health` = 200.
4. **ZK (Bagian H2–H5):** `cargo prove build` + `cargo prove vkey`, prover SP1 (`NETWORK_PRIVATE_KEY`, jangan di-commit), `pnpm deploy:verifier` di 46630, transfer owner ke multisig, isi `ZGUARD_ZK_SP1_PROVER_URL`, `ZGUARD_ZK_SP1_PROGRAM_VKEY`, `ZGUARD_ZK_SP1_GATEWAY`, `ZGUARD_ZK_VERIFIER_ADDRESS`.
5. **Uji manual I9** di web live dengan MetaMask/Rabby + ETH/USDG faucet (baris yang masih "belum diuji").
6. **Perm/terminal:** beri akses repo agar helper SDK dipasang default-on dan diberi test UI hard-fail.
7. Monitoring/alert, audit pihak ketiga, dan alamat treasury/buyback milik ZGuard.

