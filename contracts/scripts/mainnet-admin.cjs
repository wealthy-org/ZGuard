// Owner/treasury operations for the Perm mainnet (4663) deployment.
//
//   ACTION=status                                    (read-only, no key)
//   ACTION=set-quote-signer   QUOTE_SIGNER_ADDRESS=0x…
//   ACTION=configure-referral REFERRER_ADDRESS=0x… REFERRAL_SHARE_BPS=5000   (0 removes the referrer)
//   ACTION=set-treasury       TREASURY_ADDRESS=0x…    (fees already accrued stay claimable by the OLD treasury)
//   ACTION=set-pause-guardian PAUSE_GUARDIAN_ADDRESS=0x…
//   ACTION=claim-fees         TOKEN=0x… (0x000…0 for ETH) RECIPIENT=0x…   (signer = beneficiary)
//   ACTION=pause | unpause
//   ACTION=transfer-ownership NEW_OWNER=0x…   (Ownable2Step: Router + every owned adapter → pending)
//   ACTION=accept-ownership                    (signer = the pending owner; completes the handoff)
//   ACTION=set-adapter        ADAPTER=v4|v3|v2|weth ENABLED=0|1   (venue kill-switch / re-enable)
//   ACTION=set-hook           HOOK=0x… VERIFIED=0|1                (pin/unpin one Aggregator Hook codehash)
//   ACTION=set-hook-provider  ENABLED=0|1                          (all Aggregator Hook steps on/off)
//
// State-changing actions need CONFIRM_MAINNET=1 and MAINNET_DEPLOYER_PRIVATE_KEY (owner) or the
// relevant beneficiary key. Run with:
//   npx hardhat run contracts/scripts/mainnet-admin.cjs --network robinhoodMainnet

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.resolve(__dirname, "../..", process.env.MANIFEST || "deployments/robinhood-mainnet.json");

function address(label, value) {
  if (!value || !ethers.isAddress(value)) throw new Error(`${label} must be an address`);
  return ethers.getAddress(value);
}

async function main() {
  const action = process.env.ACTION || "status";
  if (!fs.existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}. Deploy first.`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  // "localhost" = `anvil --fork-url …` / `hardhat node` fork used for rehearsals; never a real mainnet endpoint.
  const isFork = hre.network.name === "hardhat" || hre.network.name === "localhost";
  const network = await ethers.provider.getNetwork();
  if (hre.network.name === "hardhat") await ethers.provider.send("evm_mine", []);
  if (Number(network.chainId) !== manifest.chainId) throw new Error(`Connected to ${network.chainId}, manifest is ${manifest.chainId}`);
  for (const key of ["permRouter", "v4Adapter", "v3Adapter"]) {
    if (!manifest[key]) throw new Error(`${path.basename(manifestPath)} has no ${key} yet (placeholder manifest). Deploy first: contracts/scripts/deploy-mainnet.cjs`);
    if ((await ethers.provider.getCode(manifest[key])) === "0x") {
      throw new Error(`${key} ${manifest[key]} has no bytecode on ${hre.network.name}${isFork ? " — a fresh fork does not contain rehearsal contracts; deploy them on this fork first" : ""}`);
    }
  }

  const router = await ethers.getContractAt("PermRouter", manifest.permRouter);
  const v4 = await ethers.getContractAt("PermV4Adapter", manifest.v4Adapter);
  const v3 = await ethers.getContractAt("PermV3Adapter", manifest.v3Adapter);
  const v2 = manifest.v2Adapter ? await ethers.getContractAt("PermV2Adapter", manifest.v2Adapter) : null;
  const weth = manifest.wethAdapter ? await ethers.getContractAt("PermWethAdapter", manifest.wethAdapter) : null;
  // Every Ownable2Step contract of the deployment (PermWethAdapter is ownerless).
  const owned = [["PermRouter", router], ["PermV4Adapter", v4], ["PermV3Adapter", v3], ...(v2 ? [["PermV2Adapter", v2]] : [])];
  const PROVIDER_IDS = {
    v4: ethers.id("UNISWAP_V4_DIRECT"), v3: ethers.id("UNISWAP_V3"), v2: ethers.id("UNISWAP_V2"), weth: ethers.id("WETH_WRAP"),
  };
  const AGGREGATOR_HOOK = ethers.id("UNISWAP_V4_AGGREGATOR_HOOK");

  const status = async () => {
    const version = await router.activePolicyVersion();
    const policy = await router.feePolicies(version);
    const rows = {
      router: router.target,
      owner: await router.owner(),
      pendingOwner: await router.pendingOwner(),
      treasury: await router.treasury(),
      quoteSigner: await router.quoteSigner(),
      pauseGuardian: await router.pauseGuardian(),
      paused: await router.paused(),
      feePolicy: `v${version}: ${policy.platformFeeBps} bps gross, ${Number(policy.rebateShareBps) / 100}% rebate, enabled=${policy.enabled}`,
      v4Adapter: `${v4.target} enabled=${(await router.adapters(v4.target)).enabled}`,
      v3Adapter: `${v3.target} enabled=${(await router.adapters(v3.target)).enabled}`,
      ...(v2 ? { v2Adapter: `${v2.target} enabled=${(await router.adapters(v2.target)).enabled}` } : {}),
      ...(weth ? { wethAdapter: `${weth.target} enabled=${(await router.adapters(weth.target)).enabled}` } : {}),
      hookProvider: (await router.hookProviderIds(v4.target)) === AGGREGATOR_HOOK ? "UNISWAP_V4_AGGREGATOR_HOOK (enabled)" : "disabled",
      treasuryClaimableETH: ethers.formatEther(await router.claimableFees(ethers.ZeroAddress, await router.treasury())),
    };
    for (const hook of manifest.verifiedHooks || []) {
      const pinned = await v4.verifiedHookCodehashes(hook.address);
      rows[`hook ${hook.address}`] = pinned === hook.runtimeCodehash ? `${hook.version} · pinned` : pinned === ethers.ZeroHash ? "not pinned" : "PIN MISMATCH";
    }
    for (const [label, contract] of owned.slice(1)) {
      const adapterOwner = await contract.owner();
      const pending = await contract.pendingOwner();
      rows[`${label} owner`] = `${adapterOwner}${pending !== ethers.ZeroAddress ? ` (pending ${pending})` : ""}`;
    }
    for (const entry of manifest.referrals || []) {
      rows[`referral ${entry.referrer}`] = `${Number(await router.referralShares(entry.referrer)) / 100}% of net fee · claimable ETH ${ethers.formatEther(await router.claimableFees(ethers.ZeroAddress, entry.referrer))}`;
    }
    for (const [key, value] of Object.entries(rows)) console.log(`  ${key.padEnd(24)} ${value}`);
  };

  console.log(`Perm mainnet · ${manifestPath.split("/").pop()} · action=${action}`);
  if (action === "status") return status();

  if (process.env.CONFIRM_MAINNET !== "1" && !isFork) {
    throw new Error("State-changing mainnet action: re-run with CONFIRM_MAINNET=1");
  }
  // FORK_SIGNER (fork rehearsals only) acts as another unlocked/impersonated account, e.g. the new owner for accept-ownership.
  if (process.env.FORK_SIGNER && !isFork) throw new Error("FORK_SIGNER is only allowed on a local fork");
  if (process.env.FORK_SIGNER) await ethers.provider.send("anvil_impersonateAccount", [address("FORK_SIGNER", process.env.FORK_SIGNER)]).catch(() => undefined);
  const signer = process.env.FORK_SIGNER ? await ethers.getSigner(address("FORK_SIGNER", process.env.FORK_SIGNER)) : (await ethers.getSigners())[0];
  if (!signer) throw new Error("MAINNET_DEPLOYER_PRIVATE_KEY (owner or beneficiary key) is required");
  const owner = await router.owner();
  const ownerOnly = !["claim-fees", "accept-ownership"].includes(action);
  if (action === "pause" && signer.address !== owner && signer.address === await router.pauseGuardian()) {
    // pause() is callable by the pause guardian as well as the owner.
  } else if (ownerOnly && signer.address !== owner) {
    throw new Error(`${action} must be sent by the PermRouter owner ${owner}; the configured key is ${signer.address}`);
  }
  const send = async (label, txPromise) => {
    const receipt = await (await txPromise).wait(1);
    console.log(`  ✓ ${label}\n    ${manifest.explorerUrl}/tx/${receipt.hash}`);
    return receipt;
  };
  const save = () => fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  switch (action) {
    case "set-quote-signer": {
      const next = address("QUOTE_SIGNER_ADDRESS", process.env.QUOTE_SIGNER_ADDRESS);
      if ((await ethers.provider.getCode(next)) !== "0x") throw new Error("Quote signer must be an EOA/KMS key address");
      await send(`setQuoteSigner(${next})`, router.connect(signer).setQuoteSigner(next));
      manifest.quoteSigner = next; manifest.roles.quoteSigner = next; save();
      break;
    }
    case "configure-referral": {
      const referrer = address("REFERRER_ADDRESS", process.env.REFERRER_ADDRESS);
      const bps = Number(process.env.REFERRAL_SHARE_BPS ?? 5_000);
      if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error("REFERRAL_SHARE_BPS must be 0..10000 (share of the NET fee; 0 removes)");
      if (referrer === owner) console.warn("⚠ Referrer equals the owner; Klip 08 should use a separate referrer wallet.");
      await send(`configureReferral(${referrer}, ${bps})`, router.connect(signer).configureReferral(referrer, bps));
      const others = (manifest.referrals || []).filter((r) => r.referrer.toLowerCase() !== referrer.toLowerCase());
      manifest.referrals = bps === 0 ? others : [...others, { referrer, shareBpsOfNetFee: bps }]; save();
      break;
    }
    case "set-treasury": {
      const next = address("TREASURY_ADDRESS", process.env.TREASURY_ADDRESS);
      const previous = await router.treasury();
      if (next === previous) throw new Error(`Treasury is already ${next}`);
      const stranded = await router.claimableFees(ethers.ZeroAddress, previous);
      await send(`setTreasury(${next})`, router.connect(signer).setTreasury(next));
      if (stranded > 0n) console.log(`  ℹ ${ethers.formatEther(stranded)} ETH (and any token fees) accrued before this change stay claimable by the previous treasury ${previous}.`);
      manifest.treasury = next; manifest.roles.treasury = next; save();
      break;
    }
    case "set-pause-guardian": {
      const next = address("PAUSE_GUARDIAN_ADDRESS", process.env.PAUSE_GUARDIAN_ADDRESS);
      await send(`setPauseGuardian(${next})`, router.connect(signer).setPauseGuardian(next));
      manifest.pauseGuardian = next; manifest.roles.pauseGuardian = next; save();
      break;
    }
    case "claim-fees": {
      const token = address("TOKEN", process.env.TOKEN || ethers.ZeroAddress);
      const recipient = address("RECIPIENT", process.env.RECIPIENT || signer.address);
      const amount = await router.claimableFees(token, signer.address);
      if (amount === 0n) throw new Error(`Nothing claimable for ${signer.address} in ${token}`);
      await send(`claimFees(${token}) → ${recipient}`, router.connect(signer).claimFees(token, recipient));
      break;
    }
    case "pause": await send("pause()", router.connect(signer).pause()); break;
    case "unpause": await send("unpause()", router.connect(signer).unpause()); break;
    case "transfer-ownership": {
      const next = address("NEW_OWNER", process.env.NEW_OWNER);
      if (next === owner) throw new Error("NEW_OWNER is already the owner");
      for (const [label, contract] of owned) {
        if ((await contract.owner()) !== signer.address) throw new Error(`${label} is owned by ${await contract.owner()}, not ${signer.address}`);
        await send(`${label}.transferOwnership(${next}) — pending acceptOwnership()`, contract.connect(signer).transferOwnership(next));
      }
      manifest.pendingOwner = next; save();
      const isContract = (await ethers.provider.getCode(next)) !== "0x";
      console.log(`\n  Next: the new owner must call acceptOwnership() (selector 0x79ba5097) on:`);
      for (const [label, contract] of owned) console.log(`    ${label.padEnd(14)} ${contract.target}`);
      console.log(isContract
        ? "  NEW_OWNER has code (multisig/timelock, or an EIP-7702-delegated EOA): send acceptOwnership() from it on each contract above."
        : "  NEW_OWNER is an EOA: run ACTION=accept-ownership with MAINNET_DEPLOYER_PRIVATE_KEY set to the new owner key.");
      break;
    }
    case "accept-ownership": {
      let accepted = 0;
      for (const [label, contract] of owned) {
        const pending = await contract.pendingOwner();
        if (pending === ethers.ZeroAddress) { console.log(`  · ${label}: nothing pending`); continue; }
        if (pending !== signer.address) throw new Error(`${label} pending owner is ${pending}, not ${signer.address}`);
        await send(`${label}.acceptOwnership()`, contract.connect(signer).acceptOwnership());
        accepted += 1;
      }
      if (!accepted) throw new Error("No pending ownership transfer for this key");
      manifest.owner = signer.address; manifest.roles.owner = signer.address; delete manifest.pendingOwner; save();
      break;
    }
    case "set-adapter": {
      const key = String(process.env.ADAPTER || "").toLowerCase();
      const target = { v4, v3, v2, weth }[key];
      if (!target) throw new Error("ADAPTER must be v4, v3, v2 or weth (and exist in the manifest)");
      const enabled = process.env.ENABLED === "1";
      if (process.env.ENABLED !== "0" && process.env.ENABLED !== "1") throw new Error("ENABLED must be 0 or 1");
      await send(`configureAdapter(${key}, enabled=${enabled})`, router.connect(signer).configureAdapter(target.target, PROVIDER_IDS[key], enabled));
      break;
    }
    case "set-hook": {
      const hook = address("HOOK", process.env.HOOK);
      if (process.env.VERIFIED !== "0" && process.env.VERIFIED !== "1") throw new Error("VERIFIED must be 0 or 1");
      const verified = process.env.VERIFIED === "1";
      const listed = (manifest.verifiedHooks || []).find((entry) => entry.address.toLowerCase() === hook.toLowerCase());
      if (verified && !listed) throw new Error(`${hook} is not in manifest.verifiedHooks; re-run discover-aggregator-hooks.mjs and redeploy the manifest entry first`);
      if (verified && ethers.keccak256(await ethers.provider.getCode(hook)) !== listed.runtimeCodehash) throw new Error(`${hook} runtime codehash differs from the manifest`);
      await send(`v4.setVerifiedHook(${hook}, ${verified})`, v4.connect(signer).setVerifiedHook(hook, verified));
      break;
    }
    case "set-hook-provider": {
      if (process.env.ENABLED !== "0" && process.env.ENABLED !== "1") throw new Error("ENABLED must be 0 or 1");
      const enabled = process.env.ENABLED === "1";
      await send(`configureHookProvider(v4, ${enabled ? "UNISWAP_V4_AGGREGATOR_HOOK" : "0x0"})`, router.connect(signer).configureHookProvider(v4.target, enabled ? AGGREGATOR_HOOK : ethers.ZeroHash));
      manifest.hookProviderStatus = enabled ? "enabled-codehash-pinned" : "disabled"; save();
      break;
    }
    default:
      throw new Error(`Unknown ACTION ${action}`);
  }
  await status();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
