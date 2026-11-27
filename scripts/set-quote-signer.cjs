const { ethers } = require("ethers");

const RPC_URL = "https://rpc.testnet.chain.robinhood.com";
const ROUTER_V2 = "0xFdC667735C8998fEB83C4c3c7B4eCFB404DAFA87";
const NEW_QUOTE_SIGNER = "0x6E184fc4692c7b2B202D1b6c472D8CDEf8FF86f5";

const routerAbi = [
  "function owner() view returns (address)",
  "function quoteSigner() view returns (address)",
  "function setQuoteSigner(address newSigner) external",
];

async function main() {
  console.log("=".repeat(70));
  console.log("SET QUOTE SIGNER - PermRouter v2");
  console.log("=".repeat(70));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const routerContract = new ethers.Contract(ROUTER_V2, routerAbi, provider);

  // Read owner and quoteSigner
  console.log("\n1. Membaca state router...");
  const owner = await routerContract.owner();
  const currentQuoteSigner = await routerContract.quoteSigner();
  console.log(`   Owner: ${owner}`);
  console.log(`   QuoteSigner saat ini: ${currentQuoteSigner}`);

  // Verify deployer private key matches owner
  console.log("\n2. Memverifikasi kunci deployer...");
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) {
    console.error("   ❌ DEPLOYER_PRIVATE_KEY tidak di-set di .env");
    process.exit(1);
  }

  const wallet = new ethers.Wallet(deployerKey);
  console.log(`   Address dari kunci deployer: ${wallet.address}`);
  console.log(`   Cocok dengan owner: ${wallet.address.toLowerCase() === owner.toLowerCase()}`);

  if (wallet.address.toLowerCase() !== owner.toLowerCase()) {
    console.log("\n❌ Kunci deployer TIDAK cocok dengan owner. Tidak bisa panggil setQuoteSigner.");
    console.log("   Butuh kunci private owner: " + owner);
    return;
  }

  if (currentQuoteSigner.toLowerCase() === NEW_QUOTE_SIGNER.toLowerCase()) {
    console.log("\n✅ QuoteSigner sudah sama dengan kunci baru. Tidak perlu diubah.");
    return;
  }

  // Call setQuoteSigner using ethers
  console.log(`\n3. Memanggil setQuoteSigner(${NEW_QUOTE_SIGNER})...`);
  const signer = wallet.connect(provider);
  const routerWithSigner = new ethers.Contract(ROUTER_V2, routerAbi, signer);

  const tx = await routerWithSigner.setQuoteSigner(NEW_QUOTE_SIGNER);
  console.log(`   Tx hash: ${tx.hash}`);

  console.log("   Menunggu konfirmasi transaksi...");
  const receipt = await tx.wait();
  console.log(`   Status: ${receipt.status}`);
  console.log(`   Block: ${receipt.blockNumber}`);

  // Verify
  console.log("\n4. Verifikasi perubahan...");
  const newQuoteSigner = await routerContract.quoteSigner();
  console.log(`   QuoteSigner baru: ${newQuoteSigner}`);
  console.log(`   Cocok dengan kunci baru: ${newQuoteSigner.toLowerCase() === NEW_QUOTE_SIGNER.toLowerCase()}`);

  console.log("\n=".repeat(70));
  console.log("SELESAI. Update .env kamu:");
  console.log("  QUOTE_SIGNER_ADDRESS=" + NEW_QUOTE_SIGNER);
  console.log("  PERM_QUOTE_SIGNER_PRIVATE_KEY=<kunci-private-yang-cocok>");
  console.log("  Kemudian restart dev server dan cek health:");
  console.log("  curl http://localhost:3000/api/health?requireIndexer=1");
  console.log("=".repeat(70));
}

main().catch(console.error);
