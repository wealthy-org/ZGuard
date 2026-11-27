# Perbandingan net output Perm vs direct same-pool

## Batas bukti

Perbandingan ini memakai **local read-only fork** Robinhood Chain mainnet (`4663`) pada source block `119976784`. Tidak ada transaksi mainnet, deployment mainnet, atau dana nyata yang dikirim.

Hook `0xA1AD09c98710d2C709e3bea03708823255312888` tetap berstatus **unapproved compatibility candidate**. Hasil ini membuktikan kompatibilitas teknis PermV4Adapter dan accounting Router v2, bukan provenance resmi, audit approval, atau izin admission.

## Metode

- Pair: WETH/UP.
- PoolId: `0x9ef343fe68e0702b7013a38444b2123e61e8cab2ede3f575a0d5b77cb1f8c95b`.
- Hook runtime codehash: `0x537d4b59539aa00520d3f9885e00707e9a7bfe6670455ae54a3099e9b53129c7`.
- Exact input untuk kedua leg: `0.001 WETH`.
- Kedua swap dimulai dari state pool yang sama menggunakan snapshot/revert fork.
- Leg **Perm Router v2** melewati quote EIP-712, fee/rebate accounting, PermV4Adapter, dan canonical settlement events.
- Leg **direct same-pool** memanggil PermV4Adapter sebagai harness minimal tanpa Perm Router platform fee. Baseline ini mengisolasi efek fee dan overhead Router; ini bukan klaim gas untuk seluruh direct router pihak ketiga.
- Output adalah saldo UP yang benar-benar diterima recipient.
- Gas tetap ditampilkan dalam native units dan tidak dikonversi ke UP karena tidak ada conversion quote terpisah yang dipin untuk benchmark ini.

## Hasil

| Jalur | Exact input | Input ke pool | Gross platform fee | Fee rebate | Net platform fee | Net output diterima | Gas used | Gas cost pada fork |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Perm Router v2 → hook pool | 0.001 WETH | 0.0009985 WETH | 0.000002 WETH | 0.0000005 WETH | 0.0000015 WETH | 16.486093291644107017 UP | 477,840 | 0.000479819779998240 native |
| Direct same-pool harness | 0.001 WETH | 0.001 WETH | 0 | 0 | 0 | 16.510859559280844704 UP | 281,888 | 0.000283055914415168 native |
| Selisih direct − Perm | — | 0.0000015 WETH | — | — | — | 0.024766267636737687 UP | −195,952 untuk direct | −0.000196763865583072 native untuk direct |

## Interpretasi

1. Policy Router v2 konsisten: gross fee `0.20%`, rebate `25%` dari gross fee, dan net fee `0.15%`.
2. `0.001 WETH - 0.0000015 WETH = 0.0009985 WETH` benar-benar menjadi routed input Perm.
3. Pada snapshot ini, output Perm sekitar `0.15%` lebih rendah daripada direct baseline karena direct leg memasukkan seluruh `0.001 WETH` ke pool, sedangkan Perm memasukkan input setelah net platform fee.
4. Perm memakai `195,952` gas lebih banyak, sekitar `69.51%` di atas minimal direct-adapter baseline. Overhead mencakup signature validation, replay/accounting state, fee reserves, route evidence, dan final settlement evidence.
5. LP fee, hook fee, dan price impact pool sudah tercermin pada output kedua leg; item tersebut bukan sumber rebate Perm.
6. Hasil ini tidak mendukung klaim “Perm selalu termurah”. Nilai Perm yang dibuktikan di sini adalah fee policy yang transparan, rebate yang konsisten, route/accounting validation, dan canonical receipt evidence.
7. Gas dan output UP sengaja tidak digabung menjadi satu angka “net after gas” tanpa konversi native→UP yang valid dan sebanding.

## Reproduksi

```bash
corepack pnpm contracts:compare:mainnet-hook
```

Script menolak network selain local Hardhat fork, memverifikasi chain ID, Hook/PoolId/codehash, menjalankan kedua leg dari snapshot yang sama, dan gagal jika recipient output atau fee conservation tidak cocok.

Untuk compatibility evidence terpisah:

```bash
corepack pnpm contracts:test:mainnet-hook
```

Test tersebut mewajibkan canonical `HookSwap`, `RouteStepSettled` dengan `hook != 0`, dan exact `hookCodehash`.
