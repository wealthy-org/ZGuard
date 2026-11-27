import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import walletModule from "./lib/wallet-attestation.cjs";

const { verifyWalletConnectSignature, walletConnectMessage } = walletModule;
const reviewer = privateKeyToAccount(`0x${"42".repeat(32)}`);
const candidate = { chainId: 46630, permRouter: `0x${"10".repeat(20)}` };
const wallet = {
  transactionHash: `0x${"11".repeat(32)}`,
  receiptId: `0x${"12".repeat(32)}`,
  walletName: "Reviewed mobile wallet",
  device: "Android test device",
  testedAt: "2026-11-17T10:00:00.000Z",
  attestedBy: "Independent QA",
  sessionTopicHash: `0x${"13".repeat(32)}`,
  attestationSigner: reviewer.address,
};
wallet.attestationSignature = await reviewer.signMessage({ message: walletConnectMessage(candidate, wallet) });
assert.equal(await verifyWalletConnectSignature(candidate, wallet, reviewer.address), reviewer.address);
await assert.rejects(() => verifyWalletConnectSignature(candidate, { ...wallet, device: "tampered" }, reviewer.address), /signature is invalid/i);
await assert.rejects(() => verifyWalletConnectSignature(candidate, wallet, `0x${"20".repeat(20)}`), /not in WALLETCONNECT_QA_SIGNERS/i);
console.log("WalletConnect QA attestation: trusted signature verifies and tampering fails closed");
