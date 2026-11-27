const { ethers } = require("ethers");

async function main() {
  console.log("=".repeat(70));
  console.log("GENERATE KUNCI QUOTE SIGNER BARU");
  console.log("=".repeat(70));

  const wallet = ethers.Wallet.createRandom();

  console.log("\n=== KUNCI BARU UNTUK QUOTE SIGNER ===");
  console.log("ADDRESS (QUOTE_SIGNER_ADDRESS): " + wallet.address);
  console.log("PRIVATE KEY (PERM_QUOTE_SIGNER_PRIVATE_KEY): " + wallet.privateKey);

  console.log("\n".repeat(1));
  console.log("CATATAN PENTING:");
  console.log("1. Simpan PRIVATE KEY dengan aman. Jangan share ke siapa pun.");
  console.log("2. Alamat di atas harus di-set sebagai quoteSigner di router on-chain.");
  console.log("3. Hanya owner router (0x665fF833a1F33FA47730a6ADd86559641a7a9940)");
  console.log("   yang bisa memanggil setQuoteSigner ke alamat baru ini.");
  console.log("4. Kamu butuh tim berwenang/owner untuk memanggil setQuoteSigner");
  console.log("   ke alamat baru ini sebelum bisa dipakai.");
  console.log("");
  console.log("Di .env kamu (setelah owner sudah set on-chain):");
  console.log("QUOTE_SIGNER_ADDRESS=" + wallet.address);
  console.log("PERM_QUOTE_SIGNER_PRIVATE_KEY=" + wallet.privateKey);
  console.log("=".repeat(70));
}

main().catch(console.error);
