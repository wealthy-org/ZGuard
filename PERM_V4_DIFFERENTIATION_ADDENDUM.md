# Perm — Diferensiasi v4 dan Fee Rebate

**Tanggal:** 17 November 2026  
**Status:** rekomendasi implementasi untuk dimasukkan ke dev brief copycat Stoa. Dokumen ini adalah modul tambahan, bukan spesifikasi lengkap seluruh produk Stoa/Perm.

## 1. Keputusan produk yang direkomendasikan

Pertahankan baseline router multi-venue Stoa, lalu tambahkan dua kemampuan:

1. **Hook-aware routing:** kandidat rute dapat mencakup Uniswap v4 Aggregator Hooks yang deployment, quote, dan integrasinya sudah diverifikasi pada chain target.
2. **Perm Fee Rebate:** bagian fee platform Perm dikembalikan sebagai pengurangan biaya pada settlement swap. Berlaku pada transaksi melalui router Perm yang memenuhi aturan, termasuk rute V2/V3 atau venue lain, tanpa memaksa semuanya melewati pool v4.

Tujuan pengguna: akses sumber likuiditas lebih luas, biaya platform bersih yang jelas, dan bukti hasil trade. Menambahkan teknologi hook saja tidak cukup sebagai diferensiasi; manfaat biaya dan hasil eksekusi harus dapat diukur.

**Jangan menetapkan “semua trade wajib melewati custom hook Perm” sebagai default.** Routing tetap mengevaluasi hasil bersih dan biaya gas. Mode v4-only dapat disediakan sebagai pilihan eksplisit untuk pengujian, dengan coverage dan trade-off yang jelas.

## 2. Apa yang sudah ada pada referensi

Menurut dokumentasi Stoa, router sudah mencakup venue v4 dan memeriksa hasil yang diterima terhadap minimum output pengguna. Dukungan pool v4 umum, slippage protection, dan perbandingan venue merupakan baseline copycat; tidak diklaim sebagai inovasi baru Perm.

Sumber:

- https://stoadex.com/trade
- https://stoadex.com/docs/router-sdk
- https://stoadex.com/docs/contracts
- https://stoadex.com/docs/risks

Dokumentasi tersebut menjelaskan produk referensi, bukan bukti bahwa deployment Perm sudah tersedia. Jangan memakai kontrak Stoa sebagai treasury, fee recipient, atau identitas Perm.

## 3. Batas teknis hook

Hook v4 adalah kontrak yang terkait dengan suatu pool. Callback seperti `beforeSwap` / `afterSwap` hanya berjalan bila pool terkait benar-benar dipakai dan hook memiliki permission callback tersebut. Hook bukan middleware global yang otomatis melihat swap pada semua DEX.

Hook merupakan bagian dari `PoolKey` dan ditentukan ketika pool dibuat. Tidak dapat menambahkan custom hook Perm ke pool Pons/Uniswap existing hanya dengan mengubah router. Pool v4 memiliki satu alamat hook; hook lain tidak dapat ditumpuk begitu saja. Komposisi beberapa fungsi membutuhkan desain hook/adapter yang kompatibel.

Aggregator Hooks berbeda dari sekadar “pool v4 yang punya hook”: mekanismenya membungkus sumber likuiditas eksternal menjadi antarmuka pool v4. Menurut pengumuman Uniswap, integrasi Aggregator Hooks tersedia di Ethereum, Base, dan Robinhood Chain. Coverage venue, alamat hook, API access, dan quote aktual tetap diverifikasi saat implementasi. Jangan mengekstrapolasi dukungan tersebut ke Elysium tanpa bukti deployment.

Sumber:

- https://developers.uniswap.org/docs/protocols/v4/concepts/hooks
- https://blog.uniswap.org/aggregator-hooks-are-now-live

## 4. Spesifikasi fitur A — Hook-aware routing

### Flow

1. Pengguna memilih pasangan, amount, recipient, dan slippage.
2. Routing service meminta kandidat dari adapter baseline Perm dan provider yang mendukung Aggregator Hooks.
3. Validasi chain, input amount, token identity/decimals, snapshot freshness, spender, execution target, dan minimum output kandidat.
4. Bandingkan output bersih setelah seluruh fee yang diketahui dan estimasi gas yang dapat dibandingkan dalam satu unit.
5. Tampilkan route yang dipilih, venue/hook yang benar-benar diketahui, output, fee, rebate, min received, dan estimasi gas terpisah.
6. Pengguna menyetujui serta menandatangani transaksi; settlement memverifikasi output aktual dan recipient.
7. Receipt ditampilkan dengan route aktual, tx hash, input/output, fee/rebate dan gas aktual.

Adapter provider baru tidak boleh menerima arbitrary calldata/target tanpa validasi atau izin yang ditinjau. Jika kandidat memakai Universal Router, verifikasi ABI/command dan alur approvals/Permit2 yang dibutuhkan; jangan mengasumsikan ABI Stoa kompatibel atau menggandakan custody/fee.

Jika arsitektur awal hanya bisa mengeksekusi satu kandidat provider secara utuh, cukup bandingkan kandidat utuh dahulu. Split route antarsumber memerlukan implementasi dan pengujian tambahan; jangan mengiklankannya sebelum tersedia.

### Pemilihan rute

Gunakan snapshot/quote time yang sebanding, amount dan fee policy yang sama. Output estimasi bukan jaminan hasil di masa depan. Estimasi gas tidak dapat dibandingkan dengan output token tanpa konversi harga yang valid; jika konversi tidak tersedia, tampilkan trade-off dan jangan mengklaim optimasi total biaya.

Saat hook/provider tidak memberikan quote yang valid, kandidat tersebut unavailable. Router dapat memilih kandidat lain yang valid. Jangan memberi label Hook-powered pada swap V2/V3 murni atau mengarang alamat hook dari string deskripsi route.

Satu kandidat bisa mencakup beberapa sumber; deduplikasi untuk pelaporan coverage dan hindari mengklaim jumlah venue lebih besar dari sumber yang benar-benar diamati.

## 5. Spesifikasi fitur B — Perm Fee Rebate

### Ekonomi awal

Rebate berasal dari **fee platform Perm sendiri**. Fee LP, fee hook pihak ketiga, protocol fee Uniswap, dan gas bukan dana rebate Perm. Tidak ada pencetakan token atau janji cashback di luar pendapatan/anggaran yang tersedia.

Untuk rilis pertama gunakan pengurangan biaya instan, sehingga tidak perlu kontrak klaim, campaign points, staking, atau transaksi kedua:

```text
grossPermFee = floor(feeBasisAmount × platformFeeBps / 10_000)
rebate = floor(grossPermFee × rebateShareBps / 10_000)
netPermFee = grossPermFee − rebate
0 ≤ rebateShareBps ≤ 10_000
```

Contoh perhitungan dalam token fee yang sama, sebagai fixture saja: input 100 USDG, fee platform hipotetis 0,20% → gross fee 0,20 USDG; rebate share 25% → pengurangan 0,05 USDG; net fee Perm 0,15 USDG. Angka tersebut belum menjadi kebijakan komersial final. Tampilkan semua komponen sumber lain secara terpisah.

Jika fee diambil dari input, input yang benar-benar dipakai untuk swap harus mencerminkan net fee tersebut; quote harus menggunakan metode yang sama. Jika implementasi memakai fee output, hitung dan tampilkan dalam output units. Jangan mencampurkan kedua basis atau menjanjikan rebate input sebagai tambahan token output yang belum pasti.

### Aturan

- Tetapkan satu skema rebate sederhana dan versioned; tidak perlu tier holder token pada rilis pertama.
- Rebate tidak boleh melebihi gross Perm fee. Jika gross fee nol, rebate juga nol pada desain ini.
- Referral, integrator share, treasury dan rebate tidak boleh dihitung dari bagian yang sama dua kali; total distribusi harus cocok dengan gross Perm fee.
- Transaksi revert tidak menghasilkan rebate atau volume reward; gas yang terpakai bukan biaya yang otomatis dikembalikan.
- Quote mengikat fee version, recipient, chain, amount, deadline, serta min output. Perubahan kebijakan tidak boleh menaikkan fee pengguna diam-diam setelah konfirmasi.
- Jangan mengumumkan minimum output yang bergantung pada budget rebate di luar transaksi. Settlement menghitung pengurangan fee dan output secara konsisten.

### UI

Tambahkan breakdown ringkas: `Platform fee`, `Fee rebate`, `Net platform fee`, `Minimum received`, `Network fee`. Gunakan istilah **fee rebate / fee discount** untuk model pengurangan biaya; jangan menampilkan cashback wallet yang sebenarnya tidak pernah ditransfer terpisah.

Perbandingan harga menampilkan hasil bersih setelah rebate, dengan dasar perhitungan yang sama untuk setiap kandidat. Tidak boleh menaikkan fee lalu mengklaim diskon seolah pengguna pasti lebih hemat dari venue langsung.

## 6. Setiap trade: router-level accounting; hook hanya pada rutenya

| Tindakan | Semua swap melalui entry point Perm yang relevan | Hook pool v4 tertentu |
|---|---|---|
| Recipient/min output/deadline checks | Ya | Jangan menjadi satu-satunya penegakan global |
| Gross fee dan rebate | Router/settlement Perm | Hanya bila desain pool memang mengimplementasikannya |
| Proof receipt | Router event + indexer | Callback event memberi detail pool bila tersedia |
| Custom AMM curve/dynamic LP fee | Tidak berlaku pada venue lain | Dapat diterapkan melalui hook terkait |
| Perubahan hook pool existing | Tidak bisa dilakukan router | Memerlukan pool baru/desain yang sesuai |

Router bukan hook. Pembedaan ini harus muncul pada technical docs dan penamaan komponen. Jika user mengeksekusi langsung di venue lain di luar entry point Perm, rebate global Perm tidak otomatis berlaku.

Receipt minimum: chain ID, tx hash/log identity, route/provider identifiers yang dapat dibuktikan, token in/out, actual amounts, gross fee, rebate, net fee, recipient, fee policy version. Indexer tidak boleh menyimpulkan callback custom Perm berjalan hanya karena transaksi menyentuh v4.

## 7. Custom hook Perm — tahap tambahan setelah router parity

Jika owner menginginkan kontrak hook milik Perm sendiri, evaluasi **Perm Adaptive Fee Pool** untuk satu pasangan likuid dahulu. `beforeSwap` menghitung dynamic LP fee dari aturan terbatas dan data yang tervalidasi, dengan min/max fee dan freshness check. Tujuannya menyesuaikan kompensasi LP dengan kondisi pasar, bukan menjamin harga selalu lebih murah atau menghapus impermanent loss.

Fitur ini memerlukan pool baru dengan dynamic-fee flag dan hook yang sesuai, LP/inventory nyata, oracle/observations yang tahan manipulasi, quoter yang mereplikasi hook, serta review/audit tambahan. Fee LP yang berubah terpisah dari fee platform dan rebate Perm.

Uji bahwa perubahan fee dapat memberi nilai lebih dibanding pool statis dan dampak gasnya. Jangan membangun custom pool semata-mata untuk memasang label hook pada tiap transaksi. Router memilih pool tersebut ketika kompetitif setelah biaya dan memenuhi batas pengguna; tidak dipaksa mengambilnya.

Sumber: https://developers.uniswap.org/docs/protocols/v4/concepts/dynamic-fees

## 8. Urutan implementasi dan acceptance

1. Selesaikan baseline router dan UI copycat dengan identitas Perm; pertahankan konfigurasi chain terpisah mengikuti scope brief induk.
2. Tambahkan platform fee/rebate accounting dan receipt, diuji untuk exact-input dahulu.
3. Integrasikan kandidat Aggregator Hooks pada RH setelah quote, approvals, deployment dan execution simulation berhasil diverifikasi.
4. Bandingkan trade nyata dari segi net output, gas dan keberhasilan; hindari klaim selalu termurah.
5. Custom adaptive-fee pool menyusul hanya setelah ada alasan ekonomi, likuiditas dan spesifikasi risk yang layak.

Acceptance:

- [ ] Quote dan execution menggunakan fee basis, rounding dan rebate policy yang sama.
- [ ] Fee zero, rebate zero/100%, nominal dust, referral sharing, native-token wrapping, dan allowance benar teruji.
- [ ] Min output mengacu pada saldo yang benar-benar diterima recipient setelah seluruh potongan yang berlaku.
- [ ] Payout, fee serta rebate rollback ketika transaksi gagal; tidak ada reward dari transaksi revert.
- [ ] Router tidak menyisakan approval tanpa batas ke target dinamis atau menerima arbitrary spender/call target.
- [ ] Hook yang tidak ada, hook berubah/malicious, reentrancy, quote stale dan gas tambahan ditangani.
- [ ] Fallback memilih route lain sebelum pengguna menandatangani atau dalam batas rencana yang sudah diotorisasi; tidak membuat transaksi baru yang tak disetujui.
- [ ] Setidaknya satu proof menunjukkan pool/hook aktual pada rute; satu proof lain menunjukkan route tanpa hook masih mendapat fee rebate router.
- [ ] Tidak ada klaim seluruh venue sudah terintegrasi, profit terjamin, bebas MEV, atau semua swap memakai hook jika bukti tidak mendukung.

## 9. Positioning yang dapat digunakan setelah implementasi

Usulan: **“Compare routes. See every fee. Keep more of your swap.”**

Deskripsi: Perm membandingkan rute yang didukung, termasuk sumber melalui v4 Aggregator Hooks ketika tersedia, dan mengurangi fee platform melalui rebate yang transparan pada settlement.

Ini diferensiasi produk yang perlu dibuktikan melalui hasil dan biaya riil. Tidak ada klaim bahwa v4 aggregation atau fee rebate secara global belum pernah ada.
