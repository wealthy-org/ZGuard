const { getAddress, isAddress, recoverMessageAddress } = require("viem");
const { stableStringify } = require("./release-assurance.cjs");

function walletConnectAttestationPayload(candidate, wallet) {
  return {
    schemaVersion: 1,
    kind: "walletconnect-session",
    chainId: candidate.chainId,
    router: candidate.permRouter,
    transactionHash: wallet.transactionHash,
    receiptId: wallet.receiptId,
    walletName: wallet.walletName,
    device: wallet.device,
    testedAt: wallet.testedAt,
    attestedBy: wallet.attestedBy,
    sessionTopicHash: wallet.sessionTopicHash,
  };
}

function walletConnectMessage(candidate, wallet) {
  return `Perm WalletConnect E2E attestation v1\n${stableStringify(walletConnectAttestationPayload(candidate, wallet))}`;
}

async function verifyWalletConnectSignature(candidate, wallet, configuredSigners) {
  if (!isAddress(wallet.attestationSigner) || !/^0x[0-9a-fA-F]{130}$/.test(wallet.attestationSignature || "")) {
    throw new Error("WalletConnect signed QA attestation is required");
  }
  const trusted = new Set(String(configuredSigners || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  if (!trusted.size || !trusted.has(wallet.attestationSigner.toLowerCase())) {
    throw new Error("WalletConnect attestation signer is not in WALLETCONNECT_QA_SIGNERS");
  }
  const recovered = await recoverMessageAddress({
    message: walletConnectMessage(candidate, wallet), signature: wallet.attestationSignature,
  });
  if (getAddress(recovered) !== getAddress(wallet.attestationSigner)) throw new Error("WalletConnect QA attestation signature is invalid");
  return getAddress(recovered);
}

module.exports = { verifyWalletConnectSignature, walletConnectAttestationPayload, walletConnectMessage };
