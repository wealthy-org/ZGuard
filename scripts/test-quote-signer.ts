import assert from "node:assert/strict";
import { recoverTypedDataAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PERM_QUOTE_TYPES, quoteSignerConfiguration, quoteSignerExecutionReady, signPermQuote, type PermQuoteMessage } from "../lib/server/quote-signer";

async function main() {
  const localKey = `0x${"31".repeat(32)}` as const;
  const local = privateKeyToAccount(localKey);
  const remote = privateKeyToAccount(`0x${"32".repeat(32)}`);
  const attacker = privateKeyToAccount(`0x${"33".repeat(32)}`);
  const router = `0x${"10".repeat(20)}` as Address;
  const domain = { name: "Perm", version: "2", chainId: 46630, verifyingContract: router } as const;
  const message: PermQuoteMessage = {
    account: `0x${"11".repeat(20)}`,
    tokenIn: `0x${"12".repeat(20)}`,
    tokenOut: `0x${"13".repeat(20)}`,
    amountIn: 1_000_000n,
    minAmountOut: 900_000n,
    gasEstimate: 330_000n,
    recipient: `0x${"14".repeat(20)}`,
    deadline: 2_000_000_000n,
    quotedAt: 1_999_999_900n,
    policyVersion: 1,
    chainId: 46_630n,
    referrer: `0x${"0".repeat(40)}`,
    routeHash: `0x${"15".repeat(32)}`,
  };
  const originalFetch = globalThis.fetch;
  const previous = Object.fromEntries([
    "PERM_QUOTE_SIGNER_MODE", "PERM_QUOTE_SIGNER_URL", "PERM_QUOTE_SIGNER_TOKEN",
    "PERM_QUOTE_SIGNER_PRIVATE_KEY", "QUOTE_SIGNER_ADDRESS", "NODE_ENV",
    "PERM_EXECUTION_MODE", "NEXT_PUBLIC_PERM_EXECUTION_MODE", "PERM_STAGING_CHAIN_ID",
    "PERM_STAGING_WALLET_ALLOWLIST", "PERM_STAGING_ALLOW_BURNER_SIGNER",
    "NEXT_PUBLIC_PERM_ROUTER_ADDRESS",
  ].map((key) => [key, process.env[key]]));

  try {
    for (const key of [
      "PERM_EXECUTION_MODE", "NEXT_PUBLIC_PERM_EXECUTION_MODE", "PERM_STAGING_CHAIN_ID",
      "PERM_STAGING_WALLET_ALLOWLIST", "PERM_STAGING_ALLOW_BURNER_SIGNER", "NEXT_PUBLIC_PERM_ROUTER_ADDRESS",
    ]) delete process.env[key];
    process.env.PERM_QUOTE_SIGNER_MODE = "local";
    process.env.PERM_QUOTE_SIGNER_PRIVATE_KEY = localKey;
    delete process.env.PERM_QUOTE_SIGNER_URL;
    delete process.env.PERM_QUOTE_SIGNER_TOKEN;
    delete process.env.QUOTE_SIGNER_ADDRESS;
    const localConfiguration = quoteSignerConfiguration();
    assert.equal(localConfiguration.custodyReady, false);
    assert.equal(quoteSignerExecutionReady(localConfiguration, "development"), true);
    assert.equal(quoteSignerExecutionReady(localConfiguration, "production"), false);
    const localResult = await signPermQuote(domain, message);
    assert.equal(await recoverTypedDataAddress({ domain, types: PERM_QUOTE_TYPES, primaryType: "PermQuote", message, signature: localResult.signature }), local.address);
    const mutableEnvironment = process.env as Record<string, string | undefined>;
    mutableEnvironment.NODE_ENV = "production";
    await assert.rejects(() => signPermQuote(domain, message), /requires authenticated remote custody/i);
    if (previous.NODE_ENV === undefined) delete mutableEnvironment.NODE_ENV;
    else mutableEnvironment.NODE_ENV = previous.NODE_ENV;

    process.env.PERM_QUOTE_SIGNER_MODE = "staging-local";
    process.env.PERM_QUOTE_SIGNER_PRIVATE_KEY = localKey;
    process.env.QUOTE_SIGNER_ADDRESS = local.address;
    process.env.PERM_EXECUTION_MODE = "allowlisted-testnet-staging";
    process.env.NEXT_PUBLIC_PERM_EXECUTION_MODE = "allowlisted-testnet-staging";
    process.env.PERM_STAGING_CHAIN_ID = "46630";
    process.env.PERM_STAGING_WALLET_ALLOWLIST = message.account;
    process.env.PERM_STAGING_ALLOW_BURNER_SIGNER = "1";
    process.env.NEXT_PUBLIC_PERM_ROUTER_ADDRESS = router;
    mutableEnvironment.NODE_ENV = "production";
    const stagingConfiguration = quoteSignerConfiguration();
    assert.equal(stagingConfiguration.configured, true);
    assert.equal(stagingConfiguration.custodyReady, false);
    assert.equal(stagingConfiguration.stagingReady, true);
    assert.equal(quoteSignerExecutionReady(stagingConfiguration, "production"), true);
    const stagingResult = await signPermQuote(domain, message);
    assert.equal(await recoverTypedDataAddress({ domain, types: PERM_QUOTE_TYPES, primaryType: "PermQuote", message, signature: stagingResult.signature }), local.address);
    await assert.rejects(() => signPermQuote(domain, { ...message, account: attacker.address }), /not on the staging wallet allowlist/i);
    process.env.PERM_STAGING_ALLOW_BURNER_SIGNER = "0";
    assert.equal(quoteSignerConfiguration().configured, false);

    for (const key of [
      "PERM_EXECUTION_MODE", "NEXT_PUBLIC_PERM_EXECUTION_MODE", "PERM_STAGING_CHAIN_ID",
      "PERM_STAGING_WALLET_ALLOWLIST", "PERM_STAGING_ALLOW_BURNER_SIGNER", "NEXT_PUBLIC_PERM_ROUTER_ADDRESS",
    ]) delete process.env[key];
    if (previous.NODE_ENV === undefined) delete mutableEnvironment.NODE_ENV;
    else mutableEnvironment.NODE_ENV = previous.NODE_ENV;

    process.env.PERM_QUOTE_SIGNER_MODE = "remote";
    delete process.env.PERM_QUOTE_SIGNER_PRIVATE_KEY;
    process.env.QUOTE_SIGNER_ADDRESS = remote.address;
    process.env.PERM_QUOTE_SIGNER_URL = "https://signer.example/v1/sign";
    process.env.PERM_QUOTE_SIGNER_TOKEN = "test-token-at-least-sixteen";
    let responseMode: "valid" | "attacker" | "malformed" | "wrong-content-type" | "oversized" | "chunked-oversized" = "valid";
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), process.env.PERM_QUOTE_SIGNER_URL);
      assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${process.env.PERM_QUOTE_SIGNER_TOKEN}`);
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
      assert.ok(init?.signal);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.message.gasEstimate, message.gasEstimate.toString());
      if (responseMode === "oversized") return new Response("x".repeat(16_385), { status: 200 });
      if (responseMode === "chunked-oversized") {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(9_000));
            controller.enqueue(new Uint8Array(9_000));
            controller.close();
          },
        }), { status: 200 });
      }
      if (responseMode === "malformed") {
        return new Response(JSON.stringify({ address: remote.address, signature: "0x1234" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const signer = responseMode === "attacker" ? attacker : remote;
      const signature = await signer.signTypedData({ domain, types: PERM_QUOTE_TYPES, primaryType: "PermQuote", message });
      return new Response(JSON.stringify({ address: remote.address, signature }), {
        status: 200,
        headers: { "content-type": responseMode === "wrong-content-type" ? "text/plain" : "application/json" },
      });
    };
    const remoteConfiguration = quoteSignerConfiguration();
    assert.equal(remoteConfiguration.custodyReady, true);
    assert.equal(quoteSignerExecutionReady(remoteConfiguration, "production"), true);
    const remoteResult = await signPermQuote(domain, message);
    assert.equal(remoteResult.address, remote.address);
    responseMode = "attacker";
    await assert.rejects(() => signPermQuote(domain, message), /does not match the authorized address/i);
    responseMode = "malformed";
    await assert.rejects(() => signPermQuote(domain, message), /invalid identity or signature/i);
    responseMode = "wrong-content-type";
    await assert.rejects(() => signPermQuote(domain, message), /invalid content type/i);
    responseMode = "oversized";
    await assert.rejects(() => signPermQuote(domain, message), /response is too large/i);
    responseMode = "chunked-oversized";
    await assert.rejects(() => signPermQuote(domain, message), /response is too large/i);
    console.log("Quote signer: production rejects ordinary local custody; explicit chain-pinned allowlisted staging accepts only its burner key; remote signatures verify and malformed responses fail closed");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
