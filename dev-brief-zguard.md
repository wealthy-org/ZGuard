# ZGuard — Dev Brief: Scanner & Guard Layer di Robinhood Chain

**Tanggal:** 24 November 2026 (WITA, UTC+8)  
**Status:** brief implementasi untuk developer. Nama produk final: **ZGuard** (X: [@zguard_rhc](https://x.com/zguard_rhc)). Ticker token usulan **$ZGUARD [ASUMSI]**, belum dikunci.  
**Chain:** Robinhood Chain mainnet, chain id `4663`. Testnet `46630` hanya untuk uji, bukan produksi.  
**Ruang lingkup:** copycat perangkat **scanner/guard** Agent Wormhole saja. **Wormbook tidak masuk ruang lingkup** (bukan launchpad, bukan jejaring sosial, bukan venue trading).

Dokumen ini tidak memuat jadwal, sprint, atau timeline. Item yang belum diverifikasi ditandai **[ASUMSI]** atau **[PERLU CEK]**. Jangan mengisi alamat, fee, atau metrik yang tidak ada di sini.

---

## 1. Overview dan positioning

ZGuard adalah lapisan pemeriksaan untuk agen dan terminal yang bertransaksi di Robinhood Chain. Sebelum agen menandatangani pembayaran atau swap, dan sebelum ia mempercayai metadata token, produk ini menjawab tiga pertanyaan dalam **satu panggilan API**:

1. **Quote-match (x402 / intent pembayaran):** apakah transaksi yang akan ditandatangani sama dengan quote yang diterima (penerima, jumlah, aset, chain)? Ini adalah paritas dengan `wormhole-x402`.
2. **Simulasi transaksi:** apa yang benar-benar terjadi jika transaksi itu dijalankan di RHC (perubahan saldo, approval, pemanggilan hook/pool, revert)? Agent Wormhole secara eksplisit tidak melakukan ini.
3. **Token risk RHC:** apa status token di chain ini — pemegang, likuiditas, pajak, wewenang mint/owner, dan keadaan bonding curve Pons atau pool Uniswap v4 setelah graduasi?

Ketiga cek itu adalah diferensiator utama terhadap Agent Wormhole. Wormhole kuat pada kesesuaian quote dan pemindaian teks, tetapi tidak merangkum simulasi dan token risk (holder, LP, tax, mint authority, state curve Pons) dalam satu API. Simulator klasik (Blockaid, Webacy, GoPlus) menjawab “apa yang akan dilakukan transaksi ini”, bukan “apakah ini pembayaran yang di-quote”, dan pada umumnya **tidak merinci dukungan RHC 4663**.

Positioning singkat:

> Satu pemeriksaan sebelum agen atau terminal menandatangani di Robinhood Chain: apakah ini quote yang sama, apa yang akan terjadi onchain, dan bagaimana kondisi tokennya.

Bukan Wormbook. Bukan venue. Bukan social feed. Output adalah **verdict** (`allow` / `deny` / `abstain`) plus rincian tiap cek, yang dipasang default-on di terminal trading RHC/Pons milik Bos dan di router Perm, serta tersedia sebagai MCP untuk agen (Claude Code, Cursor, OpenClaw, dan host MCP lain).

### 1.1 Keputusan produk yang sudah dikunci

- Chain utama: **RHC 4663**. Inti produk harus benar di RHC dulu (USDG, Stock Token resmi, curve Pons, pool Uniswap v4 / hook Pons).
- Bentuk: SDK/CLI lokal + MCP + API hosted + wrapper signer.
- Billing: bayar per panggilan lewat **x402**, prioritas **USDG di RHC**. USDC di Base dan Solana **opsional**.
- Revenue API dipakai untuk **buyback dan burn** token produk yang diluncurkan di Pons. Ticker, supply, dan pecahan fee: **[ASUMSI]**, dikunci Bos nanti. Perangkat lokal tidak boleh mensyaratkan kepemilikan token itu.
- Distribusi prioritas: default-on di **terminal trading RHC/Pons Bos** dan **Perm**, bukan semata paket yang harus dipasang developer luar.

### 1.2 Yang sengaja tidak dibangun

- Launchpad, burrow, callout, atau pool trading ala Wormbook.
- Klaim “aman” / “safe”. Verdict resmi: `allow`, `deny`, `abstain`. Temuan teks: `clean_by_rules` atau `findings`, bukan sertifikat kelayakan investasi.
- Hardcode ticker Stock Token sebagai identitas aset. Identitas canonical hanya alamat di registri resmi Robinhood.

---

## 2. Breakdown referensi: Agent Wormhole

Sumber utama: [agentwormhole.com](https://www.agentwormhole.com/), [llms.txt](https://www.agentwormhole.com/llms.txt), [docs](https://docs.agentwormhole.com), [dashboard API](https://dashboard.agentwormhole.com/llms.txt), [GitHub README](https://github.com/runningoffcode/agent-wormhole/blob/main/README.md). Angka adopsi dan harga token bergerak; angka di bawah adalah hasil riset 24 November 2026 WITA kecuali dinyatakan lain.

### 2.1 Produk referensi (tiga permukaan)

| Permukaan | Paket / layanan | Fungsi | Biaya (referensi) |
|---|---|---|---|
| Instruction / read-write guard | PyPI `wormhole-guard` v0.2.1, CLI `wormhole` | Hook Claude Code: tulis config, baca output tool, outbound ke agen lain; harden + baseline hash | Gratis, offline, Apache 2.0 |
| Payment / tx guard | npm `wormhole-x402` v0.11.0 + MCP `wormhole-x402-mcp` | Membandingkan pembayaran Solana/EVM dengan quote x402; `inspectTransaction` membandingkan calldata dengan intent | Inti offline gratis; hosted `/v1/verify` berbayar |
| Launch / metadata | API hosted + badge + atestasi ed25519 | Memindai name/symbol/description/logo (v2) atau tokenURI (v3); atestasi kedaluwarsa 24 jam | Lookup/badge gratis; scan berbayar |

Hook coding-agent (`guard` / `readguard` / `outbound` / `harden`) adalah bagian dari referensi, tetapi **bukan prioritas MVP** ZGuard. MVP meniru lapisan yang dipakai agen trading: quote-match, pemindaian teks/metadata yang akan dibaca agen, wrapper signer, dan API hosted — lalu menambah simulasi + token risk RHC.

Cara kerja quote-match yang harus dipahami (jangan diklaim sebagai temuan baru):

- Quote datang sebagai JSON di respons HTTP 402, di saluran yang tidak dilalui model.
- Pembayaran diizinkan hanya jika tujuan, jumlah, token, dan chain cocok dengan quote.
- Di Solana, akun token merchant diturunkan dari `(recipient, mint)`.
- Di EVM, wrapper merakit semua jalur tanda tangan (`signTypedData`, `signTransaction`, `sendTransaction`, dan setara) dan memeriksa otorisasi EIP-3009 terhadap quote.
- Byte yang tidak bisa di-decode menghasilkan **ABSTAIN**, bukan izin.
- Kode contoh referensi: `X402-001` tujuan salah, `X402-002` jumlah salah, `X402-006` delegate/approve. Sumber: [halaman x402](https://www.agentwormhole.com/x402), [npm wormhole-x402](https://www.npmjs.com/package/wormhole-x402).

Wormhole menyatakan domain EIP-712 yang mereka verifikasi dari kontrak terpasang (bukan dari dokumen) mencakup USDC di Base, Ethereum, Arbitrum, Polygon, Arc, serta **USDG di RHC 4663 / testnet 46630**. Pasangan `(chain, asset)` lain mereka abstain. Lapisan tanda tangan Arc (`/api/v1/arc/*`) mereka **pause**; verifikasi Arc tetap jalan. **[PERLU CEK]** pada implementasi: apakah USDG di `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` benar-benar mengekspos EIP-3009 / `receiveWithAuthorization`, dan berapa domain EIP-712 onchain-nya. Baca dari kontrak, jangan menebak domain.

### 2.2 Tabel harga referensi (Agent Wormhole)

Sumber: [README Prices](https://github.com/runningoffcode/agent-wormhole/blob/main/README.md). Tidak ada langganan, tidak ada minimum. Prepaid via x402 (USDC Base/Solana, atau USDG RHC). Kredit habis → HTTP 402 berisi quote yang bisa dibayar.

| Panggilan | Harga |
|---|---|
| `/v1/verify` (verifikasi pembayaran) | $0,003 |
| `/v1/check` dan watch re-check | $0,005 |
| `/v1/scan` (pre-mint atau on-demand) | $0,01 / token |
| Setiap tautan metadata yang dipindai | $0,005 (tautan gagal/ditolak: gratis) |
| Lookup token, badge, halaman atestasi, kunci tanda tangan | gratis, tanpa kunci |
| Perangkat lokal (`wormhole-guard`, inti `wormhole-x402`) | gratis, offline |

Angka Hoodscan “$0,015 per scan” **tidak dipakai**; itu tidak cocok dengan README resmi. **[PERLU CEK]** jika ingin meniru persis: bandingkan invoice live dashboard dengan tabel di atas.

Harga ZGuard **belum dikunci**. Usulan awal (semua **[ASUMSI]**, boleh diubah Bos) ada di §10.

### 2.3 Model revenue dan pecahan buyback (referensi)

Sumber: [docs Agent Wormhole, bagian $WORM](https://agentwormhole.com/docs#worm), dikonfirmasi di X ([28 Okt 2026](https://x.com/agentwormhole/status/2115326561586975087), [3 Okt 2026](https://x.com/agentwormhole/status/2106478803333894170)).

1. Seluruh pendapatan API hosted (scan, check, verify) dipakai membeli $WORM di RHC, lalu dibakar ke alamat mati.
2. Wormbook (di luar ruang lingkup kita) mengambil 0,30% dari fee pool 1,00% (0,70% ke kreator). 80% bagian Wormbook di-buyback/burn; 20% untuk infrastruktur. Rute non-pool Wormbook: fee 0,50% sekali.

Karena ZGuard **tidak** membangun Wormbook, acuan revenue kita hanya poin 1: pendapatan API → buyback dan burn token Pons. Pecahan 80/20 tidak otomatis berlaku. **[ASUMSI]** default: 100% pendapatan bersih API ke buyback/burn, kecuali Bos menetapkan treasury operasional.

Alamat $WORM (hanya referensi, jangan dipakai sebagai treasury kita):

| Peran | Alamat | Sumber |
|---|---|---|
| Token $WORM | `0x3bA500F1AbabbCF0F0247D06D1c56Fd7E6C4c09D` | [Pons](https://ponsfamily.com/launchpad/0x3ba500f1ababbcf0f0247d06d1c56fd7e6c4c09d), [docs Wormhole](https://agentwormhole.com/docs#worm) |
| Burn | `0x000000000000000000000000000000000000dEaD` | docs Wormhole |
| Buyback | `0x6e1a191893608307b7de09bbb9b652bd4c608cc5` | docs Wormhole |
| Fee Wormbook (multisig) | `0xf5285e3E7998b83D410C56512c513fc6d5d4EC04` | docs Wormhole |

$WORM diluncurkan di Pons 8 Sep 2026 18:56 UTC (9 Sep 2026 02:56 WITA), pair PLTR, supply 1B, creator fee 0,9%. Market cap di halaman Pons pada sesi riset 24 Nov 2026: **$821,2K**, 205.465 trade. Angka ini bergerak. Posting peluncuran: [X](https://x.com/agentwormhole/status/2097398904950038707).

[Larpcheck](https://larpcheck.app/0x3ba500f1ababbcf0f0247d06d1c56fd7e6c4c09d) mencatat 37.728.594,87 WORM di alamat mati (3,77% dari 1B), tetapi menyebut angka buyback dolar di situs ($14.425) **tidak didukung API mereka sendiri**. Angka dolar buyback: **[PERLU CEK]**, jangan dikutip sebagai fakta produk kita.

### 2.4 Integrasi yang mereka klaim

Klaim dari akun resmi [@agentwormhole](https://x.com/agentwormhole) (id `2080916983990894592`), kecuali ada tautan dokumentasi pihak kedua. Volume pemakaian pihak kedua **belum dihitung ulang onchain** dalam riset ini.

| Integrasi | Klaim | Sumber |
|---|---|---|
| @xona_agent Wallet | x402 guard default-on sebelum dana keluar | [17 Nov 2026](https://x.com/agentwormhole/status/2122696521888186637) |
| @Incentiv_net | “Official partner for agentic safety”; paket lokal sementara rel x402 Incentiv masih dibangun | [20 Nov 2026](https://x.com/agentwormhole/status/2123863121685086607) |
| @RaetoCC | 43 pemeriksaan payee, 7 pembayaran buruk dihentikan | [12 Nov 2026](https://x.com/agentwormhole/status/2120953108159144262) |
| @OakAgentKit | `check_before_use` + `check_token`; biaya ditanggung Oak | [5 Nov 2026](https://x.com/agentwormhole/status/2118460673290023373), docs Oak menyebut `wormhole_token_check` / `wormhole_scan_text` ([oakagentkit.org](https://oakagentkit.org/)) |
| @gloamtrade MCP 0.4.0 | Cek pra-pembayaran opsional lewat `GLOAM_WORMHOLE_KEY` | [24 Okt 2026](https://x.com/agentwormhole/status/2114033201479897249), [gloam.trade/docs/agents](https://www.gloam.trade/docs/agents) |

Akun X dibuat 25 Jul 2026 15:24 WITA; ~4.482 pengikut, 387 post, centang bisnis. BD: @Rishee_A (founder @fairscalexyz, SuperteamUK), [8 Nov 2026](https://x.com/agentwormhole/status/2119502920714461528). Tim paket: GitHub `runningoffcode`, penulis PyPI/npm `JuicyD3v` (pseudonim).

### 2.5 Metrik adopsi paket (bukan token)

Diukur 24 Nov 2026 WITA:

| Sinyal | Angka | Sumber |
|---|---|---|
| GitHub `runningoffcode/agent-wormhole` | 6 star, 2 fork, 16 issue terbuka; dibuat 25 Jul 2026 15:09 WITA; push terakhir 11 Nov 2026 04:35 WITA | [GitHub API](https://github.com/runningoffcode/agent-wormhole) |
| npm `wormhole-x402` | 158 unduhan/minggu; v0.11.0 terbit 2 Nov 2026 14:16 WITA | [npm](https://www.npmjs.com/package/wormhole-x402) |
| PyPI `wormhole-guard` | 24 unduhan 7 hari, 90 unduhan 30 hari, 0 hari terakhir; v0.2.1 | [pypistats](https://pypistats.org/api/packages/wormhole-guard/recent) |

Audit pihak ketiga: [zauth, 21–25 Sep 2026](https://zauth.inc/audits/agent-wormhole), whitebox pada `wormhole-x402`, `mcp-trade-guard`, `agent-wormhole`, dan jalur pembayaran dashboard. 83 temuan ditutup, 1 ditarik, 0 terbuka, pada versi sekitar 0.9.2–0.9.9. Zauth menyatakan versi setelah jendela review **tidak dinilai**. npm kini 0.11.0. [Hoodscan](https://hoodscan.co/project/agent-wormhole) masih menulis “Audits: None published” — data itu kedaluwarsa.

Pelajaran untuk implementasi: paket open-source mereka gratis dan adopsi organiknya masih kecil. Moat mereka ada di integrasi default-on dan API hosted, bukan di unduhan npm. ZGuard harus menang di **distribusi** (Perm + terminal) dan di **tiga cek dalam satu panggilan**, bukan di merilis CLI yang sama.

---

## 3. Referensi kompetitor

Dipakai untuk memosisikan API, bukan untuk disalin mentah. Tidak ada yang terlihat sebagai “Wormhole + simulasi + token risk Pons/RHC” dalam satu produk.

### 3.1 TollWarden

Firewall pembayaran x402. Scan hosted + `guardSigner` opsional. Cek: payTo yang muncul dari konten (indikasi injeksi), replay nonce, overpay, PII di metadata, USDC lookalike, address poisoning, reputasi/delivery, velocity. MCP: `npx -y tollwarden`. Harga: $0,01/scan via x402 (100 panggilan pertama gratis); Pro $4,99/30 hari @ $0,005; Scale $19,99/30 hari @ $0,002. Counter di situs mereka (pihak ketiga saja, di-refresh 5 menit): 1.002 pembayaran dipindai, 74 diblokir, 130 diizinkan, 798 di-flag, 18 agen berbeda. Tidak ada atestasi peluncuran RHC/Pons. Cakupan chain di luar EVM x402: **[PERLU CEK]**.

- https://tollwarden.com/

### 3.2 Verdict 402

Firewall aksi umum, bayar per panggilan USDC di Base (x402) atau sats (L402). Termasuk `/v1/token-check` ($0,0164), `/v1/payee-check` ($0,0379), `/v1/trade-gate` ($0,0133), plus guard prompt-injection dan MCP-vet. MCP untuk Claude/Cursor. Bukan produk native RHC dan bukan pustaka quote-match offline.

- https://verdict.kechlab.com/

### 3.3 GoPlus AgentGuard dan AI Agent Security API

Hook lokal untuk skill/MCP/shell, plus API berbayar (x402, klaim 50+ chain) untuk token, alamat, simulasi transaksi, rug check. Settlement $GPS direncanakan di whitepaper. Catatan pihak ketiga: token/address security GoPlus **menyertakan RHC 4663**, tetapi approval-security tidak ([Splice](https://docs.spliceloom.com/data-providers)). Apakah jalur simulasi Agent Security API benar-benar mendukung 4663: **[PERLU CEK]**.

- https://github.com/GoPlusSecurity/agentguard/
- https://whitepaper.gopluslabs.io/goplus-network/ai-security/agentguard
- https://whitepaper.gopluslabs.io/goplus-network/web3-security/goplus-intelligence

Jangan tertukar dengan **AgentGuard.one / Axora** (https://www.agentguard.one/), produk enterprise untuk coding agent ($15/bulan), bukan guard pembayaran x402/RHC.

### 3.4 Blockaid

Simulasi transaksi dan skrining dApp/wallet, klaim 55+ chain, ada antarmuka Solana. Stack-nya berorientasi manusia yang menyetujui permintaan situs. Tidak ada daftar dukungan RHC 4663 yang ditemukan dalam riset ini. **[PERLU CEK]** dukungan 4663.

- Situs produk: https://www.blockaid.io/ — **[PERLU CEK]** path docs/API terbaru saat implementasi.
- Konteks perbandingan: https://guardian.security/blog/blockaid-alternatives/

### 3.5 Webacy

API risiko alamat/token/tx/URL; bisa dibayar per request dengan x402 USDC di Base. Chain yang mereka tulis: eth, pol, opt, arb, base, bsc, sol, sei, sui, stellar, hedera, btc. **RHC/4663 tidak ada di tabel itu.**

- https://docs.webacy.com/integrations/agent-reference

### 3.6 agentkit-guard

“Fail-closed firewall & x402 verification untuk Coinbase AgentKit di Base.” Pada pengambilan 24 Nov 2026: 0 star, 0 fork. Anggap kecil/belum terbukti sampai dicek lagi.

- https://github.com/meanusarcanus/agentkit-guard

---

## 4. Arsitektur

Empat permukaan, satu mesin keputusan. Agen atau terminal **hanya boleh meneruskan ke signer tepercaya jika keputusan efektif adalah `allow`**.

```
Terminal Bos / Perm / agen MCP
        │
        ▼
┌─────────────────────────────────────────────┐
│  ZGuard                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Quote-   │  │ Simulasi │  │ Token     │  │
│  │ match    │  │ tx RHC   │  │ risk RHC  │  │
│  │ (lokal   │  │ (RPC /   │  │ (RPC +    │  │
│  │  atau    │  │  fork)   │  │  indeks)  │  │
│  │  hosted) │  │          │  │           │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       └─────────────┴──────────────┘        │
│                    ▼                        │
│         Keputusan: allow | deny | abstain   │
└─────────────────────────────────────────────┘
        │
        ▼
  Wrapper signer (menolak tanda tangan
  kecuali ada allow yang masih berlaku
  untuk payload yang sama)
```

### 4.1 SDK / CLI lokal

- Bahasa: TypeScript sebagai SDK utama (sejajar `wormhole-x402`, mudah masuk Perm dan MCP). CLI bisa tipis di atas SDK yang sama. Python opsional di Phase 2 jika ada permintaan hook Claude Code.
- **Quote-match inti harus bisa jalan offline**: input = quote + byte transaksi / typed data. Tanpa RPC, tanpa telemetri wajib. Ini paritas referensi.
- Simulasi dan token risk membutuhkan RPC RHC; SDK memanggil API hosted atau, jika diizinkan config, RPC yang diset operator.
- Lisensi yang diusulkan: Apache 2.0 untuk inti lokal, agar setara referensi. **[ASUMSI]** sampai Bos memutuskan lain.
- Jangan mengirim isi file config agen atau private key ke server. API hosted hanya menerima quote, payload transaksi, dan alamat/metadata token yang memang akan diperiksa.

### 4.2 Server MCP

Satu server MCP yang bisa dipasang di Claude Code, Cursor, OpenClaw, dan host MCP lain. Usulan tool MVP:

| Tool | Fungsi |
|---|---|
| `guard_payment` | Quote-match + (opsional) simulasi sebelum tanda tangan x402 / pembayaran |
| `guard_transaction` | Simulasi + quote/intent-match untuk swap atau tx umum RHC |
| `check_token` | Token risk RHC + pemindaian metadata sebelum agen membaca deskripsi/ticker |
| `check_before_use` | Pemindaian teks/URL/halaman sebelum dipakai sebagai konteks |
| `guard_bundle` | Satu panggilan yang menjalankan ketiga cek (pembayaran/swap + token) |

Tanpa `API_KEY`, tool yang bisa dihitung lokal (quote-match, registry token yang sudah di-cache) tetap jalan. Tool yang butuh simulasi, indeks holder, atau scan on-demand menagih via x402 / kredit akun.

### 4.3 API hosted

Registrasi agen tanpa manusia: `POST /v1/register`, kunci `agk_…` (**[ASUMSI]** prefix; jangan meniru `awk_` milik Wormhole). Pendanaan awal opsional lewat header `X-PAYMENT` (x402). Tanpa pembayaran, saldo nol dan panggilan berbayar menjawab 402 berisi quote. Rel pembayaran yang harus dikutip: **USDG di `eip155:4663` wajib**; USDC Base (`eip155:8453`) dan USDC Solana opsional.

Hanya `"decision": "allow"` yang boleh diteruskan ke signer. Kegagalan penyimpanan kebijakan atau ketidakmampuan membaca payload = `abstain`, bukan `allow`.

### 4.4 Wrapper signer

Fungsi setara `guardEvmSigner`: membungkus semua jalur tanda tangan yang dipakai wallet/agen. Menolak menandatangani jika:

- tidak ada quote/intent untuk dibandingkan (untuk pembayaran x402), atau
- tidak ada verdict `allow` yang masih berlaku untuk hash payload yang sama, atau
- verdict `allow` sudah kedaluwarsa, atau
- payload yang hendak ditandatangani berbeda dari yang diperiksa.

`abstain` **bukan izin**. Perilaku default: tolak tanda tangan. Mode “tandatangani meski abstain” hanya boleh hidup jika operator memasangnya secara eksplisit di config, dan harus tercatat di receipt.

### 4.5 Aturan agregasi keputusan

**[ASUMSI]** sampai dikunci di config:

- Setiap cek mengembalikan `allow`, `deny`, atau `abstain`, plus kode alasan.
- Cek bisa `required` atau `advisory`. Default MVP: ketiga cek pada `guard_bundle` bersifat `required`.
- Agregasi: jika ada `required` yang `deny` → keputusan efektif `deny`. Jika tidak ada `deny` tetapi ada `required` yang `abstain` → `abstain`. `allow` hanya jika semua cek `required` menghasilkan `allow`.
- Cek `advisory` yang `deny` menjadi `flags[]` dan tidak menurunkan `allow` menjadi `deny`, kecuali config mengubahnya.
- Keputusan efektif `allow` mengikat hash kanonik dari payload yang diperiksa (quote + tx/authorization + alamat token yang relevan) dan punya `expires_at` singkat. **[ASUMSI]** 2 menit, bisa diubah.

---

## 5. Endpoint API dan skema respons

Base URL produksi: **[PERLU CEK]** (jangan hardcode domain fiktif di rilis). Versi path: `/v1`.

### 5.1 Endpoint MVP

| Method | Path | Auth | Fungsi | Tarif usulan **[ASUMSI]** |
|---|---|---|---|---|
| `POST` | `/v1/register` | tidak | Buat tenant + API key. Header `X-PAYMENT` opsional untuk isi saldo | gratis; pembayaran mengisi kredit |
| `GET` | `/v1/token/{chainId}/{address}` | tidak | Lookup cache/registry token RHC. 404 = belum diobservasi, **bukan** `allow` | gratis |
| `POST` | `/v1/verify` | key / x402 | Quote-match pembayaran atau intent | $0,003 |
| `POST` | `/v1/simulate` | key / x402 | Simulasi tx di RHC 4663 | $0,005 |
| `POST` | `/v1/token-risk` | key / x402 | Token risk RHC (holder, LP, tax, owner/mint, state Pons) | $0,01 |
| `POST` | `/v1/check` | key / x402 | Pemindaian teks/URL/metadata sebelum dibaca agen | $0,005 |
| `POST` | `/v1/guard` | key / x402 | **Satu panggilan, tiga cek** (plus `check` teks jika ada metadata/quote text) | $0,015 bundled, atau jumlah cek yang dijalankan — **[ASUMSI]** |
| `GET` | `/v1/balance` | key | Sisa kredit | gratis |

Phase 2 bisa menambah `/v1/watch`, badge, dan atestasi tanda tangan metadata. Tidak wajib di MVP.

### 5.2 Request `POST /v1/guard`

```json
{
  "network": "eip155:4663",
  "quote": {
    "asset": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    "payTo": "0x…",
    "amount": "1000000",
    "extra": {}
  },
  "payload": {
    "type": "eip3009 | evm_tx | intent",
    "authorization": {},
    "tx": "0x…",
    "intent": {
      "chainId": 4663,
      "to": "0x…",
      "function": "…",
      "args": [],
      "value": "0"
    }
  },
  "token": "0x…",
  "content": { "text": "…", "url": "https://…" },
  "checks": ["quote", "simulation", "token_risk"],
  "options": {
    "spendPolicy": {
      "maxPerPayment": { "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168": "1000000" }
    }
  }
}
```

- `network` wajib. MVP menolak atau abstain jika bukan `eip155:4663`, kecuali cek quote-only untuk rel pembayaran USDC Base/Solana yang memang diaktifkan.
- `quote` wajib untuk pembayaran x402. Untuk swap terminal/Perm, `intent` (dari kode router, bukan dari model) mengisi peran quote.
- `token` opsional; jika ada, `token_risk` dijalankan terhadap alamat itu. Jika tidak ada, turunkan alamat token dari `quote.asset` atau dari hasil decode `intent` / simulasi. Jika tidak bisa diturunkan, cek `token_risk` = `abstain`.
- Field yang tidak dikenal diabaikan, tidak boleh mengubah hash kanonik.

### 5.3 Respons kanonik

```json
{
  "decision": "allow | deny | abstain",
  "reason": "ringkasan singkat",
  "codes": ["Q-001"],
  "payload_hash": "0x…",
  "expires_at": "2026-11-24T04:00:00.000+08:00",
  "network": "eip155:4663",
  "checks": {
    "quote": {
      "decision": "allow",
      "codes": [],
      "expected": { "payTo": "0x…", "asset": "0x…", "amount": "1000000", "chainId": 4663 },
      "actual": { "payTo": "0x…", "asset": "0x…", "amount": "1000000", "chainId": 4663 }
    },
    "simulation": {
      "decision": "allow",
      "codes": [],
      "status": "success | revert | unknown",
      "gasUsed": "0x…",
      "balanceChanges": [
        { "address": "0x…", "token": "0x…", "before": "…", "after": "…", "delta": "…" }
      ],
      "approvals": [],
      "calls": [],
      "notes": []
    },
    "token_risk": {
      "decision": "allow",
      "codes": [],
      "token": "0x…",
      "kind": "stock_token | usdg | pons_curve | pons_graduated_v4 | other",
      "holders": { "count": 0, "top10Bps": 0 },
      "liquidity": { "venue": "pons_curve | uniswap_v4 | unknown", "locked": null, "detail": {} },
      "tax": { "buyBps": 0, "sellBps": 0, "snipeTaxBps": 0 },
      "authorities": { "owner": "0x…", "mintable": false, "pausable": null },
      "pons": { "factory": "0x…", "graduated": false, "sellableTokens": null, "reserves": null }
    },
    "content": {
      "decision": "allow",
      "verdict": "clean_by_rules | findings | unchecked",
      "codes": []
    }
  },
  "flags": [],
  "charged": { "asset": "USDG", "amount": "15000", "unit": "micro" }
}
```

Aturan skema:

- `decision` tingkat atas adalah hasil agregasi §4.5, bukan salinan salah satu cek.
- `abstain` wajib menyertakan kode mengapa (payload tidak ter-decode, RPC gagal, token di luar cakupan, domain EIP-712 tidak terverifikasi, dll.).
- Simulasi yang revert pada pembayaran yang “seharusnya berhasil” boleh `deny` atau `flag` sesuai config. **[ASUMSI]** MVP: revert tak terduga pada cek `required` → `deny` dengan kode `S-REVERT`.
- Jangan pernah mengembalikan kata “safe”.
- `charged.unit` dan skala: **[ASUMSI]** micro-USDG (6 desimal); selaraskan dengan desimal USDG.

Kode alasan (awalan jangan meniru `X402-` milik referensi). Usulan:

| Kode | Cek | Arti |
|---|---|---|
| `Q-001` | quote | tujuan tidak cocok dengan quote/intent |
| `Q-002` | quote | jumlah tidak cocok |
| `Q-003` | quote | token/asset tidak cocok |
| `Q-004` | quote | chain tidak cocok |
| `Q-005` | quote | tidak ada quote/intent |
| `Q-006` | quote | ada approval/delegate di luar transfer satu kali |
| `Q-007` | quote | domain EIP-712 tidak terverifikasi → abstain |
| `S-REVERT` | simulasi | transaksi revert |
| `S-DIFF` | simulasi | perubahan saldo tidak sesuai intent/quote |
| `S-APPROVE` | simulasi | muncul allowance/operator di luar yang diminta |
| `S-FAIL` | simulasi | simulasi tidak bisa dijalankan → abstain |
| `T-MINT` | token risk | wewenang mint masih hidup (di luar allowlist resmi) |
| `T-TAX` | token risk | pajak/snipe tax di atas ambang config |
| `T-LP` | token risk | likuiditas tidak terkunci / tidak terdeteksi |
| `T-HOLDER` | token risk | konsentrasi pemegang di atas ambang |
| `T-PONS` | token risk | state curve tidak konsisten atau hampir graduate (kebijakan config) |
| `T-UNKNOWN` | token risk | jenis token tidak dikenali → abstain atau flag |
| `C-FINDING` | content | aturan teks menemukan pola instruksi/payload |
| `P-401` | kebijakan | payee/asset/jumlah di luar spend policy |
| `P-UNAVAIL` | kebijakan | penyimpanan kebijakan gagal → abstain |

Ambang angka untuk `T-TAX`, `T-HOLDER`, dan sejenisnya mengikuti **open config** (§10), bukan nilai yang dikarang di kode.

---

## 6. Daftar aturan cek

### 6.1 Quote-match

Dijalankan dulu, dari byte yang sudah dipegang klien.

1. Jika ini pembayaran x402: bandingkan `payTo`, `asset`, `amount`, `chainId` dengan quote. Tidak ada quote → `deny` (`Q-005`), bukan lewat.
2. Jika ini swap/tx terminal atau Perm: bandingkan tx dengan `intent` yang disusun kode router (chain, kontrak, fungsi, argumen, `value`). Calldata harus encode ulang ke byte yang sama. Intent **tidak boleh** diisi model.
3. Tolak approval, permit, SetAuthority, operator, atau pendelegasian lain yang tidak secara eksplisit ada di intent (`Q-006` / `S-APPROVE`).
4. Domain EIP-712: hanya pasangan `(chainId, kontrak)` yang sudah dibaca dari kontrak terpasang. Selain itu `abstain` (`Q-007`).
5. `spendPolicy` opsional: cap per pembayaran, allowlist aset/payee, total lifetime. Kebijakan yang tidak terbaca → `abstain` (`P-UNAVAIL`).
6. Pindai teks di dalam quote (deskripsi merchant, memo) dengan aturan bentuk payload. Temuan tidak menggantikan cek kesesuaian angka.

Batas yang sudah diketahui dari referensi, tetap berlaku sampai diverifikasi ulang: quote wrapped-native yang tidak didukung dan transaksi yang tidak ter-decode → `abstain` atau `deny` sesuai tabel kode, jangan “dianggap aman”.

### 6.2 Simulasi transaksi RHC

Tujuan: mengisi “apa yang terjadi onchain jika tx ini dikirim sekarang”.

1. Simulasikan di state RHC 4663 terkini (fork atau `eth_call` / `debug_traceCall` / API penyedia). Metode yang dipilih harus diuji terhadap swap Uniswap v4 ber-hook dan beli/jual curve Pons — naive `eth_call` ke router bisa salah. **[PERLU CEK]** metode yang andal di RPC publik vs Alchemy/QuickNode/Chainstack.
2. Keluarkan: sukses atau revert, `gasUsed`, `balanceChanges` (ETH dan ERC-20 relevan), approval yang muncul, daftar call (termasuk hook bila terlihat).
3. Bandingkan hasil dengan quote/intent: penerima dana, aset, dan jumlah harus cocok dalam toleransi yang eksplisit (0 untuk pembayaran exact; slippage terpisah untuk swap, diambil dari intent terminal/Perm, bukan dari model).
4. Tandai pemanggilan ke `PoolManager` Uniswap v4, hook Pons, curve Pons, atau Aggregator Hook jika alamatnya dikenali (§7).
5. Kegagalan infrastruktur (RPC timeout, node tidak mendukung trace) → `abstain` (`S-FAIL`), bukan `allow`.

### 6.3 Token risk RHC

Input: alamat token di chain 4663. Identitas aset **hanya** dari alamat, bukan ticker.

1. **Klasifikasi `kind`:**
   - `usdg` jika alamat = USDG resmi.
   - `stock_token` jika alamat ada di registri resmi Robinhood ([docs contracts](https://docs.robinhood.com/chain/contracts/)).
   - `pons_curve` jika masih di bonding curve Pons (resolve dari factory yang meluncurkannya, bukan asumsi stack terbaru).
   - `pons_graduated_v4` jika sudah graduate dan hook pool = Pons V2 meme hook.
   - `other` untuk selain itu.
2. **Holder:** jumlah pemegang dan pangsa top 10 (bps). Sumber indeks: **[PERLU CEK]** (explorer API Blockscout, penyedia data, atau indeks sendiri). Jangan mengarang angka.
3. **Likuiditas:** jika curve, laporkan cadangan dan `sellableTokens()`. Jika v4, laporkan pool, hook, dan apakah posisi LP terkunci di launch locker Pons. Jika tidak terdeteksi, `T-LP` / `abstain` sesuai config.
4. **Pajak:** `feeBps`, `creatorTaxBps`, `currentSnipeTaxBps(recipient)` pada curve Pons (snipe tax 5 detik pertama, mulai 99% lalu turun, per [docs Pons v2](https://docs.ponsfamily.com/v2)). Curve tidak punya fungsi quote; harga dihitung dari `getReserves()`, fee, dan `sellableTokens()` seperti docs.
5. **Wewenang:** owner, kemampuan mint, pause, atau perubahan metadata, dibaca dari kontrak. Stock Token dan USDG resmi diperlakukan lewat allowlist alamat, bukan lewat heuristik ticker. Token “other” dengan mint masih terbuka → `T-MINT` (keputusan deny vs flag: config).
6. **State Pons:** factory asal, apakah sudah `PoolGraduated`, cadangan, dan sisa token di curve. Docs: public launching saat ini ditutup; baca `canLaunch(address)` hanya jika terminal punya alur create. Itu bukan syarat guard swap.
7. **Metadata/teks (bagian scanner):** name, symbol, description, tautan. Aturan bentuk (instruksi ke agen, karakter tak terlihat, impersonasi ticker). Hasil `clean_by_rules` | `findings` | `unchecked`. Ini paritas scanner Wormhole, bukan atestasi 24 jam (atestasi = Phase 2).

Token risk **tidak** menilai “bagus atau tidak sebagai investasi”. Ia hanya melaporkan fakta onchain + aturan yang dikonfigurasi.

### 6.4 Pemindaian konten (`/v1/check`)

Untuk teks, URL, atau cuplikan metadata yang akan dibaca agen (nama token, deskripsi, pesan, output tool). Aturan mencocokkan bentuk, bukan arti. Novel phrasing bisa lolos; itu harus tertulis di docs produk, sama seperti referensi. Di MVP cukup aturan bentuk + deteksi karakter tak tampak / ticker lookalike terhadap registri Stock Token resmi. Model LLM sebagai penilai: Phase 2, opsional.

---

## 7. Integrasi Robinhood Chain

Hanya alamat dan URL yang sudah diverifikasi dari sumber di kolom kanan. Selain itu **[PERLU CEK]**.

### 7.1 Jaringan dan RPC

Sumber: [docs.robinhood.com/chain/connecting](https://docs.robinhood.com/chain/connecting/), [artikel dukungan Robinhood](https://robinhood.com/us/en/support/articles/robinhood-chain-mainnet/).

| Properti | Mainnet | Testnet |
|---|---|---|
| Chain ID | `4663` | `46630` |
| Gas token | ETH | ETH |
| RPC publik (rate-limited, docs: jangan untuk produksi) | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer resmi | https://robinhoodchain.blockscout.com | https://explorer.testnet.chain.robinhood.com |
| Sequencer feed | `wss://feed.mainnet.chain.robinhood.com` | `wss://feed.testnet.chain.robinhood.com` |
| Delayed feed | `wss://delayed-feed.mainnet.chain.robinhood.com` | — |

Docs merekomendasikan Alchemy untuk produksi (`https://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}`), plus Chainstack, QuickNode, Blockdaemon, dRPC, Validation Cloud, Pinax. Penyedia produksi dan fallback: **open config**. Explorer komunitas tambahan: [hoodscan.co](https://hoodscan.co) (bukan explorer yang ditulis di docs koneksi resmi).

### 7.2 Aset canonical

Sumber: [docs.robinhood.com/chain/contracts](https://docs.robinhood.com/chain/contracts/), [Paxos USDG mainnet](https://docs.paxos.com/guides/stablecoin/usdg/mainnet).

| Aset | Alamat | Desimal | Catatan |
|---|---|---|---|
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | 18 | Docs Robinhood |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 | Docs Robinhood dan Paxos |

Stock Token dan ETF tertokenisasi: **jangan hardcode daftar ticker di brief ini**. Tabel resmi digenerate hidup dari registri onchain di halaman contracts di atas. Token dengan nama/ticker sama tetapi alamat berbeda **bukan** Robinhood Stock Token. REST harga offchain: base `https://api.robinhood.com/rhj/` ([docs oracles](https://docs.robinhood.com/chain/oracles-and-price-feeds/)).

Supply control USDG di Robinhood (Paxos, bukan token itu sendiri): `0xdf5FfF9cb88B3cAb50572FAE73E2EB08599D25D4` — [docs Paxos](https://docs.paxos.com/guides/stablecoin/usdg/mainnet).

### 7.3 Pons

Sumber: [docs.ponsfamily.com/llms.txt](https://docs.ponsfamily.com/llms.txt), [docs v2](https://docs.ponsfamily.com/v2). Docs meminta menyebut produk **pons** (huruf kecil).

**V2 (stack saat ini):**

| Peran | Alamat |
|---|---|
| Factory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| Meme hook (setiap pool v4 hasil graduasi) | `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` |
| Fee escrow | `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` |
| Buyback vault | `0x42df2a798f82289E177311362e8f5ccC45c1219c` |
| Launch locker | `0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952` |
| Launch and buy router | `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948` |
| Launch deployer | `0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42` |
| Graduation executor | `0xC7819B64A1dAECD7eC19856d026cb14EfBd89046` |
| Graduation guard | `0xf5695117b99B6f6401e67d4195BD653628176C6C` |

**V1 (tidak lagi launching, token lama tetap ada):**

| Peran | Alamat |
|---|---|
| Factory | `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` |
| Liquidity locker | `0x736D76699C26D0d966744cAe304C000d471f7F35` |

Docs Pons: resolve stack dari factory yang **meluncurkan token itu**, jangan mengasumsikan semua token memakai stack terbaru. Public launching saat riset ini ditulis **ditutup**; baca `canLaunch(address)` sebelum menawarkan alur create di terminal. Guard swap tetap harus mendukung token yang sudah hidup di curve atau di pool graduate.

API publik Pons (v1 docs, **[PERLU CEK]** kelengkapan untuk v2):  
https://www.ponsfamily.com/api/pons-launches · `/api/pons-token/{token}` · `/api/pons-market/{token}`

Bitquery menuliskan fee pool graduate = 0 (fee diambil hook), `tickSpacing` = 200, hooks = meme hook V2. Pakai ini sebagai petunjuk klasifikasi pool; verifikasi onchain saat implementasi. Sumber: [Bitquery Pons API](https://docs.bitquery.io/docs/blockchain/robinhood/pons-api/).

### 7.4 Uniswap v4

| Peran | Alamat | Sumber |
|---|---|---|
| PoolManager (singleton chain, bukan milik Pons saja) | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | [docs Pons / Bitquery](https://docs.bitquery.io/docs/blockchain/robinhood/pons-api/), constructor factory V2 di [Blockscout](https://robinhoodchain.blockscout.com/address/0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e?tab=contract) |
| Pons V2 meme hook | `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` | docs Pons |
| OpenHooks `PonsCurveAggregator` (membungkus curve sebagai pool v4 aggregator) | `0xb091eC27074C7a0C1bA896C063cc677F89202888` | [openhooks-dev/contract](https://github.com/openhooks-dev/contract). Repo itu menyatakan belum diaudit dan belum di-allowlist Uniswap app/API pada saat penulisan mereka. |

Universal Router, Position Manager, dan Permit2 di RHC: **[PERLU CEK]** — jangan mengisi dari chain lain. Aggregator Hooks Uniswap diumumkan live di Ethereum, Base, dan Robinhood Chain ([blog Uniswap](https://blog.uniswap.org/aggregator-hooks-are-now-live)); alamat hook yang dipakai Perm harus diambil dari brief/deployment Perm, bukan ditebak di sini.

Perm (DEX router Bos) adalah klien default-on: setiap kandidat rute yang akan ditandatangani lewat Perm dipanggil ke `/v1/guard` dengan `intent` dari kode router. Terminal trading RHC/Pons Bos melakukan hal yang sama sebelum approve/sign.

### 7.5 Chainlink

Sumber kebenaran alamat feed: [direktori JSON Robinhood mainnet](https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json), ditunjuk docs resmi ([Oracles & Price Feeds](https://docs.robinhood.com/chain/oracles-and-price-feeds/), [Building with Stock Tokens](https://docs.robinhood.com/chain/building-with-stock-tokens/)). **Selalu baca ulang direktori itu saat implementasi; jangan mengandalkan salinan stale.**

Feed yang dikonfirmasi di direktori pada 24 Nov 2026 (62 entri total):

| Feed | Proxy | Desimal | Heartbeat | Market hours di docs JSON |
|---|---|---|---|---|
| USDG / USD | `0x61B7e5650328764B076A108EFF5fa7282a1B9aD2` | 8 | 86.400 dtk | Crypto |
| ETH / USD | `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9` | 8 | 86.400 dtk | Crypto |

Feed Stock Token: satu proxy per aset, `AggregatorV3Interface.latestRoundData()`, harga sudah termasuk `uiMultiplier()` (jangan dikalikan lagi). Sebagian 24/5, sebagian 24/7 (`feedType: 247Price`). Untuk token risk, feed dipakai sebagai acuan harga (misalnya deteksi deviasi vs harga curve/pool), **bukan** syarat MVP jika indeks harga belum siap. Jika dipakai: staleness harus dicek terhadap heartbeat. Sequencer uptime feed L2 untuk 4663: docs Robinhood merekomendasikan pemeriksaan sequencer; apakah feed Chainlink-nya sudah terbit: **[PERLU CEK]** (ada catatan pihak ketiga bahwa daftar sequencer L2 belum memuat Robinhood).

Tautan Chainlink docs “tokenized equity / robinhood” yang disebut beberapa sumber pihak ketiga mengembalikan 404 pada 24 Nov 2026. Tetap pakai JSON directory + docs Robinhood sebagai sumber.

---

## 8. Fitur MVP vs Phase 2

Tidak ada jadwal. Urutan di bawah adalah batas rilis, bukan kalender.

### 8.1 MVP (harus ada sebelum produk ditawarkan)

- API hosted `/v1/register`, `/v1/verify`, `/v1/simulate`, `/v1/token-risk`, `/v1/check`, `/v1/guard`, `/v1/token/{chainId}/{address}`, `/v1/balance`.
- SDK TypeScript: quote-match offline + klien API; wrapper signer EVM untuk USDG/x402 dan tx rutin RHC.
- Server MCP dengan tool di §4.2, jalan di Claude Code dan Cursor paling tidak. OpenClaw: pasang jika host-nya sudah diverifikasi; jika belum, **[PERLU CEK]** dan jangan diklaim di README.
- Tiga cek dalam `POST /v1/guard` di chain `4663`.
- Kesadaran aset: USDG, WETH, Stock Token via registri resmi, token Pons V1/V2 (curve dan pool graduate + meme hook), PoolManager v4.
- Default-on: Perm memanggil guard sebelum menandatangani rute; terminal trading RHC/Pons Bos memanggil guard sebelum swap/launch-buy yang ditandatangani user atau agen.
- Billing x402 dalam USDG di RHC. Rel USDC Base/Solana boleh menyusul masih di MVP jika tidak menunda rel USDG, atau masuk Phase 2 — **[ASUMSI]**: USDG RHC wajib di MVP, Base/Solana opsional.
- Halaman receipt/dashboard sederhana untuk tenant: saldo, log keputusan, hash payload. Bukan Wormbook.
- Dokumentasi integrasi untuk Perm, terminal, dan MCP. Verdict tidak memakai kata “safe”.
- Alamat treasury buyback/burn disiapkan di config, meski token Pons belum diluncurkan. Jangan hardcode $WORM.
- Lapisan zk §8.3: verdict quote-match bisa diverifikasi dengan Groth16 (wajib) dan Halo2-KZG (target), verifier di RHC 4663, proof async sebagai `attestation.zk`.

### 8.2 Phase 2 (bukan syarat rilis MVP)

- Rel pembayaran USDC Base dan Solana (jika belum masuk MVP).
- Hook coding-agent setara `wormhole-guard` (write/read/outbound/harden, baseline hash).
- Atestasi metadata bertanda tangan + badge + expiry 24 jam + observation otomatis pabrik Pons.
- `/v1/watch` dan webhook bertanda tangan.
- `inspectTransaction` dengan preset intent (Universal Router v4, Permit2, bridge) setelah alamat resmi RHC diverifikasi.
- Indeks holder sendiri, skor reputasi payee, velocity cap, human-approval dashboard (pola Wormhole: agen tidak bisa menyetujui pembayarannya sendiri).
- Model LLM sebagai pelengkap pemindaian teks, di belakang aturan bentuk.
- Perluasan chain di luar 4663 untuk simulasi/token risk (hanya setelah RHC stabil).
- Buyback/burn otomatis onchain dari pendapatan API setelah token Pons hidup.

### 8.3 Lapisan zk (masuk MVP, keputusan Bos 24 Nov 2026)

Yang diambil dari Zcash adalah sistem proof-nya: **Groth16** (dipakai Zcash Sapling) dan **Halo 2** (dipakai Zcash Orchard). Chain Zcash dan ZEC tidak dipakai. Lapisan zk masuk MVP sebagai fitur utama yang menarik orang.

**Apa yang dibuktikan (MVP)**
- Hanya cek quote-match (`checks.quote`). Cek ini fungsi murni: input quote dan tx, output verdict plus kode aturan Q-xxx, jadi bisa dibuktikan apa adanya.
- Simulasi (`checks.simulation`) dan token risk (`checks.token_risk`) **tetap tanpa proof**. Keduanya bergantung pada state RPC dan butuh state proof, jadi di luar cakupan. Field `attestation.zk.scope` wajib bernilai `"quote"` supaya klaimnya tidak melebar.
- Mode lokal tetap "private by default". Quote-match jalan offline di mesin agen, dan proof hanya membawa commitment (hash), bukan isi intent.

**Jalur 1, wajib di MVP: Groth16**
- Rule engine quote-match ditulis di Rust dan dijalankan di zkVM [SP1](https://github.com/succinctlabs/sp1) atau [RISC Zero](https://github.com/risc0/risc0).
- Proof STARK dari zkVM dibungkus menjadi **Groth16 di kurva BN254**, lalu diverifikasi kontrak verifier di RHC 4663. Proof Groth16 kecil dan biaya verifikasi on-chain-nya murah. Setup tepercaya-nya memakai ceremony milik SP1 atau RISC Zero.
- Alurnya async. `decision` tetap keluar instan sesuai target latensi §9. Proof dibuat sesudahnya; lamanya detik sampai menit **[ASUMSI]**, tergantung prover lokal atau prover network.
- Proof ditempel sebagai `attestation.zk` di receipt dan diumumkan lewat webhook.
- Verifikasi on-chain bisa per proof atau per batch, misalnya merkle root dari banyak verdict. Pilihannya ada di open config.

**Jalur 2, target MVP: Halo 2 (varian KZG)**
- Zcash memakai Halo 2 dengan komitmen IPA. Varian IPA ini tanpa setup tepercaya, tapi verifikasinya di EVM tidak praktis karena terlalu mahal **[ASUMSI]**. Karena itu yang realistis di RHC adalah **Halo2-KZG**, fork PSE yang verifier Solidity-nya bisa dibuat dengan [snark-verifier](https://github.com/privacy-scaling-explorations/snark-verifier) (lihat juga [halo2 PSE](https://github.com/privacy-scaling-explorations/halo2)). KZG memakai setup universal (powers of tau), bukan setup per sirkuit.
- Isinya sirkuit quote-match tulisan tangan, tanpa zkVM. Sirkuit ini membandingkan `payTo`, `amount`, `asset`, dan `chainId` antara quote dan tx yang sudah di-decode, lalu menghasilkan hash commitment. Lebih ringan dan cepat dari zkVM, tapi cakupannya sempit dan harus dirawat terpisah dari rule engine Rust.
- Dua jalur ini menghasilkan public input yang sama (`quoteHash`, `txHash`, `verdict`, `ruleCodes`), jadi verdict yang sama bisa diverifikasi oleh dua sistem.
- Kalau Halo2-KZG belum selesai, rilis MVP boleh dengan Groth16 saja, dan marketing hanya menyebut Groth16 sebagai yang live.

**Skema respons**
- Field opsional `attestation.zk = { system: "groth16-sp1" | "groth16-risc0" | "halo2-kzg", scope: "quote", programVKey, proof, publicInputs: { quoteHash, txHash, verdict, ruleCodes }, verifierAddress, verifyTx, status: "pending" | "proven" | "verified" }`.
- `quoteHash` dan `txHash` berupa commitment, sehingga isi intent tidak terbuka.
- Endpoint tambahan: `GET /v1/attestation/{decisionId}` untuk mengambil status dan proof.

**Yang wajib dicek dulu**
- Precompile pairing BN254 (`ecPairing` 0x08, juga `ecAdd` 0x06 dan `ecMul` 0x07) aktif di RHC 4663: **[PERLU CEK]**. Ini syarat mutlak untuk kedua jalur.
- Verifier gateway SP1 atau RISC Zero sudah ter-deploy di 4663: **[PERLU CEK]**. Kalau belum, verifier di-deploy sendiri dari repo resminya.
- Biaya gas verifikasi Groth16 dan Halo2-KZG di 4663: **[PERLU CEK]**, harus diukur.

**Ditunda (bukan MVP): pembayaran x402 shielded**
- Transaksi shielded Zcash hanya ada di chain Zcash. Bridge ke RHC berarti rel pembayaran terpisah dari USDG.
- Alternatif privasi di EVM ([Railgun](https://www.railgun.org/), [Privacy Pools / 0xbow](https://0xbow.io/), [Aztec](https://aztec.network/)) belum diketahui live di RHC **[PERLU CEK]**.

---

## 9. Kriteria sukses (terukur)

Tidak ada tanggal. Rilis MVP dianggap memenuhi brief jika semua butir ini bisa ditunjukkan dengan bukti (log, receipt, tx uji, atau dump JSON), bukan dengan klaim.

1. **Satu panggilan, tiga cek.** `POST /v1/guard` pada mainnet `4663` mengembalikan `checks.quote`, `checks.simulation`, dan `checks.token_risk`, plus `decision` agregat, pada satu payload swap USDG atau Stock Token lewat Perm atau terminal.
2. **Quote-match benar.** Fixtures: (a) pembayaran yang cocok → `allow` pada cek quote; (b) `payTo` diganti → `deny` `Q-001`; (c) jumlah diganti → `deny` `Q-002`; (d) byte tidak ter-decode → `abstain`; (e) tanpa quote pada jalur x402 → `deny` `Q-005`. Wrapper signer menolak (b)–(e).
3. **Simulasi RHC.** Paling tidak satu swap Uniswap v4 ber-hook Pons dan satu trade di bonding curve Pons menghasilkan `balanceChanges` yang cocok dengan saldo onchain setelah tx uji dikirim (dev/test wallet). Tx yang sengaja revert menghasilkan `S-REVERT`, bukan `allow`.
4. **Token risk membedakan jenis.** Untuk sampel yang sama: USDG resmi, satu Stock Token registri resmi, satu token masih di curve Pons, satu token sudah graduate ke v4 + meme hook — field `kind`, likuiditas, dan state Pons terisi sesuai §6.3. Token ticker-kembar dengan alamat bukan registri **tidak** dilabel `stock_token`.
5. **Default-on distribusi.** Satu swap di Perm dan satu swap/beli di terminal Bos tidak dapat mencapai tanda tangan tanpa memanggil guard; mematikan pemanggilan di config dev menghasilkan penolakan signer atau hard-fail yang terlihat di UI, bukan jalur senyap.
6. **MCP.** Dari Claude Code atau Cursor, `check_token` dan `guard_bundle` mengembalikan skema §5.3 yang sama dengan API.
7. **Billing.** Panggilan berbayar dengan kredit USDG berhasil; kredit habis menjawab HTTP 402 dengan quote yang payable di `eip155:4663` (USDG). Perangkat lokal quote-match tanpa key tetap jalan dan tidak menagih.
8. **Keputusan fail-closed.** Satu uji: API dimatikan atau RPC simulasi gagal → keputusan efektif bukan `allow`, dan signer tidak menandatangani.
9. **Buyback (setelah token Pons ada).** Setiap unit pendapatan API yang dikonfigurasi untuk buyback bisa dilacak ke transaksi beli dan transfer ke alamat bakar yang dipublikasikan. Sebelum token ada, cukup treasury/penerimaan fee tercatat. Mekanisme otomatis: Phase 2.

10. **zk verdict.** Satu fixture `allow` dan satu fixture `deny Q-001` masing-masing punya proof Groth16 yang lolos diverifikasi kontrak verifier di 4663, dan tx verifikasinya bisa dilihat di explorer. Kalau jalur Halo2-KZG ikut rilis, kedua fixture yang sama juga lolos diverifikasi di verifier Halo2-KZG. `attestation.zk.scope` = `"quote"` di semua receipt.

Target latensi: **[ASUMSI]** p95 `/v1/guard` lengkap < 800 ms di RHC jika RPC produksi dipakai; quote-match lokal < 10 ms. Bukan gerbang rilis jika belum diukur, tetapi harus diukur dan dilaporkan.

---

## 10. Open config

Nilai yang tidak boleh dikunci diam-diam di kode. Simpan di environment / file konfigurasi / dashboard, dan tulis default di docs.

| Kunci | Default usulan | Status |
|---|---|---|
| Nama produk, domain API, prefix API key | ZGuard (dikunci); domain TBD; prefix `zg_` **[ASUMSI]** | nama dikunci, domain & prefix **[ASUMSI]** |
| Ticker token Pons | $ZGUARD | **[ASUMSI]**, belum dikunci |
| RPC produksi dan fallback | Alchemy (disarankan docs) + RPC publik sebagai cadangan non-produksi | pilih operator |
| Tarif `/v1/verify`, `/simulate`, `/token-risk`, `/check`, `/guard` | $0,003 / $0,005 / $0,01 / $0,005 / $0,015 | **[ASUMSI]**, dekat tabel Wormhole |
| Aset pembayaran x402 | USDG 4663 wajib; USDC Base & Solana opsional | keputusan Bos |
| Pecahan pendapatan ke buyback/burn vs operasional | 100% ke buyback setelah token hidup | **[ASUMSI]** |
| Alamat token Pons, pair, buyback wallet, burn address | TBD setelah peluncuran | jangan pakai alamat $WORM |
| Cek `required` vs `advisory` pada `/v1/guard` | ketiga cek `required` | **[ASUMSI]** |
| TTL verdict `allow` | 120 detik | **[ASUMSI]** |
| Ambang `T-TAX` (bps), `T-HOLDER` (top10 bps), snipe tax | TBD; sampai dikunci, laporkan angka mentah + flag, jangan auto-deny kecuali mint terbuka pada token `other` | **[ASUMSI]** |
| Spend policy default (cap, allowlist payee/aset) | off, kecuali diisi tenant | sama seperti referensi |
| Perilaku signer saat `abstain` | tolak tanda tangan | tetap, kecuali override eksplisit |
| Allowlist domain EIP-712 | hanya yang dibaca dari kontrak terpasang | wajib |
| Daftar Stock Token | registri resmi, di-refresh berkala | bukan file statis |
| Direktori feed Chainlink | URL JSON resmi, di-refresh berkala | §7.5 |
| Metode simulasi | **[PERLU CEK]** | kunci setelah uji v4 + curve |
| Lisensi SDK | Apache 2.0 | **[ASUMSI]** |
| Sistem zk MVP | Groth16 BN254 via SP1 (wajib) + Halo2-KZG (target) | **[ASUMSI]**, kunci setelah cek precompile 4663 |
| Verifikasi on-chain per proof vs batch (merkle root) | batch per N verdict | **[ASUMSI]** |
| Prover lokal vs prover network | prover network SP1 | **[ASUMSI]** |

---

## 11. Referensi teknis

### 11.1 Agent Wormhole (referensi yang ditiru sebagian)

- Situs: https://www.agentwormhole.com/
- Ringkasan mesin: https://www.agentwormhole.com/llms.txt
- Docs: https://docs.agentwormhole.com
- Docs $WORM / fee: https://agentwormhole.com/docs#worm
- x402: https://www.agentwormhole.com/x402
- Dashboard / API: https://dashboard.agentwormhole.com/llms.txt
- OpenAPI (path mereka): https://dashboard.agentwormhole.com/api/openapi.json
- GitHub: https://github.com/runningoffcode/agent-wormhole
- README (harga + integrasi): https://github.com/runningoffcode/agent-wormhole/blob/main/README.md
- npm `wormhole-x402`: https://www.npmjs.com/package/wormhole-x402
- PyPI `wormhole-guard`: https://pypi.org/project/wormhole-guard/
- Unduhan PyPI: https://pypistats.org/api/packages/wormhole-guard/recent
- Audit zauth: https://zauth.inc/audits/agent-wormhole
- Hoodscan proyek: https://hoodscan.co/project/agent-wormhole
- $WORM di Pons: https://ponsfamily.com/launchpad/0x3ba500f1ababbcf0f0247d06d1c56fd7e6c4c09d
- Larpcheck $WORM: https://larpcheck.app/0x3ba500f1ababbcf0f0247d06d1c56fd7e6c4c09d
- X @agentwormhole: https://x.com/agentwormhole
- X integrasi: [Incentiv](https://x.com/agentwormhole/status/2123863121685086607), [xona](https://x.com/agentwormhole/status/2122696521888186637), [Raeto 43/7](https://x.com/agentwormhole/status/2120953108159144262), [Oak](https://x.com/agentwormhole/status/2118460673290023373), [Gloam + volume Wormbook $500K](https://x.com/agentwormhole/status/2114033201479897249), [fee buyback](https://x.com/agentwormhole/status/2115326561586975087), [fee 1,1%](https://x.com/agentwormhole/status/2106478803333894170), [peluncuran $WORM](https://x.com/agentwormhole/status/2097398904950038707)
- Oak: https://oakagentkit.org/
- Gloam: https://www.gloam.trade/docs/agents

Catatan: https://wormbook.xyz pada 24 Nov 2026 sedang maintenance. Wormbook **tetap di luar ruang lingkup** brief ini.

### 11.2 Kompetitor

- TollWarden: https://tollwarden.com/
- Verdict 402: https://verdict.kechlab.com/
- GoPlus AgentGuard: https://github.com/GoPlusSecurity/agentguard/
- GoPlus AI Security: https://whitepaper.gopluslabs.io/goplus-network/ai-security/agentguard
- GoPlus Intelligence / Agent Security API: https://whitepaper.gopluslabs.io/goplus-network/web3-security/goplus-intelligence
- GoPlus RHC 4663 (catatan pihak ketiga): https://docs.spliceloom.com/data-providers
- AgentGuard.one (bukan GoPlus): https://www.agentguard.one/
- Webacy agent reference: https://docs.webacy.com/integrations/agent-reference
- agentkit-guard: https://github.com/meanusarcanus/agentkit-guard
- Perbandingan Blockaid (konteks): https://guardian.security/blog/blockaid-alternatives/

### 11.3 Robinhood Chain, aset, Pons, Uniswap v4, oracle

- Koneksi / RPC: https://docs.robinhood.com/chain/connecting/
- Dukungan wallet: https://robinhood.com/us/en/support/articles/robinhood-chain-mainnet/
- Kontrak token + registri Stock Token: https://docs.robinhood.com/chain/contracts/
- Oracle & price feeds: https://docs.robinhood.com/chain/oracles-and-price-feeds/
- Building with Stock Tokens: https://docs.robinhood.com/chain/building-with-stock-tokens/
- Explorer: https://robinhoodchain.blockscout.com
- USDG Paxos: https://docs.paxos.com/guides/stablecoin/usdg/mainnet
- Direktori feed Chainlink RHC: https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json
- Pons docs: https://docs.ponsfamily.com
- Pons llms.txt (alamat V1/V2): https://docs.ponsfamily.com/llms.txt
- Pons v2 quoting: https://docs.ponsfamily.com/v2
- Pons launchpad: https://www.ponsfamily.com/launchpad
- Bitquery Pons + PoolManager: https://docs.bitquery.io/docs/blockchain/robinhood/pons-api/
- Factory V2 di Blockscout: https://robinhoodchain.blockscout.com/address/0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e?tab=contract
- USDG di Blockscout: https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
- OpenHooks PonsCurveAggregator: https://github.com/openhooks-dev/contract
- Aggregator Hooks Uniswap (Ethereum, Base, RHC): https://blog.uniswap.org/aggregator-hooks-are-now-live
- Konsep hook v4: https://developers.uniswap.org/docs/protocols/v4/concepts/hooks

### 11.4 Produk Bos yang harus diintegrasikan

- Perm (DEX router, brief fee rebate / hook-aware routing): `/workspace/perm/perm-dev-brief-v4-fee-rebate.md` — pakai sebagai acuan cara Perm merakit rute dan `intent`. Alamat deployment Perm: **[PERLU CEK]** di brief/deployment terbaru Perm, jangan ditebak di sini.
- Terminal trading RHC/Pons Bos: titik panggil default-on yang sama; spesifikasi UI terminal bukan bagian brief ini.

---

*Akhir brief. Semua alamat di luar tabel bersumber di atas wajib [PERLU CEK] sebelum masuk kode produksi.*
