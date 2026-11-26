import test from "node:test";
import assert from "node:assert/strict";
import { evalCredit, evalHealth, evalPayment, evalPermGate, evalWeb, settings, summarize } from "./monitor.mjs";

const ok = (body, status = 200) => ({ ok: true, status, body });
const bad = (status, error) => ({ ok: false, status, error });

test("health: ok / http error / sequencer down / stale block", () => {
  assert.equal(evalHealth(ok({ status: "ok", chainId: 46630, sequencer: { up: true, latestBlockAgeSeconds: 2 } }), 300).status, "pass");
  assert.equal(evalHealth(bad(500), 300).status, "fail");
  assert.equal(evalHealth(bad(undefined, "timeout"), 300).status, "fail");
  assert.equal(evalHealth(ok({ status: "degraded" }), 300).status, "fail");
  assert.equal(evalHealth(ok({ status: "ok", sequencer: { up: false } }), 300).status, "fail");
  assert.match(evalHealth(ok({ status: "ok", sequencer: { up: true, latestBlockAgeSeconds: 900 } }), 300).detail, /900s old/);
});

test("payment: valid payTo passes; null, zero or settlement error fails", () => {
  const payTo = "0x141DB8c1C42B0fa5b13eE17136e4E037597886a8";
  assert.equal(evalPayment(ok({ paymentRails: { payTo, settlementMode: "deposit" } })).status, "pass");
  assert.equal(evalPayment(ok({ paymentRails: { payTo: null } })).status, "fail");
  assert.equal(evalPayment(ok({ paymentRails: { payTo: `0x${"0".repeat(40)}` } })).status, "fail");
  assert.equal(evalPayment(ok({ paymentRails: { payTo, settlementError: "bad env" } })).status, "fail");
  assert.equal(evalPayment(bad(502)).status, "fail");
});

test("web: 200 passes, anything else fails", () => {
  assert.equal(evalWeb(ok(null)).status, "pass");
  assert.equal(evalWeb(bad(404)).status, "fail");
});

test("perm gate: only enforce + ready passes; off is an alert", () => {
  assert.equal(evalPermGate(ok({ mode: "enforce", ready: true, network: "eip155:4663" })).status, "pass");
  assert.match(evalPermGate(ok({ mode: "off", ready: false })).detail, /UNGUARDED/);
  assert.match(evalPermGate(ok({ mode: "enforce", ready: false, problem: "PERM_ZGUARD_API_KEY is not set" })).detail, /blocked/);
  assert.equal(evalPermGate(ok({ mode: "weird", ready: true })).status, "fail");
  assert.equal(evalPermGate(bad(500)).status, "fail");
});

test("credit: thresholds in guard calls; missing key is a warning, 401 a failure", () => {
  assert.equal(evalCredit(ok({ creditMicroUsdg: "150000" }), 15000, 10).status, "pass");
  assert.match(evalCredit(ok({ creditMicroUsdg: "149999" }), 15000, 10).detail, /9 swaps left/);
  assert.match(evalCredit(ok({ creditMicroUsdg: "14999" }), 15000, 10).detail, /blocked now/);
  assert.equal(evalCredit({ skipped: true }, 15000, 10).status, "warn");
  assert.match(evalCredit(bad(401), 15000, 10).detail, /rejected/);
  assert.equal(evalCredit(ok({}), 15000, 10).status, "fail");
  // Unknown guard price falls back to 15000.
  assert.equal(evalCredit(ok({ creditMicroUsdg: "150000" }), NaN, 10).status, "pass");
});

test("summary: warn does not fail the run, any fail does", () => {
  assert.equal(summarize([{ name: "a", status: "pass", detail: "" }, { name: "b", status: "warn", detail: "" }]).ok, true);
  const s = summarize([{ name: "a", status: "pass", detail: "" }, { name: "b", status: "fail", detail: "x" }]);
  assert.equal(s.ok, false);
  assert.equal(s.failed.length, 1);
});

test("settings: defaults, trailing slashes, Perm can be disabled", () => {
  const d = settings({});
  assert.equal(d.api, "https://zguard-delta.vercel.app");
  assert.equal(d.web, d.api);
  assert.equal(d.perm, "https://perm-iota.vercel.app");
  assert.equal(d.minSwaps, 5);
  assert.equal(settings({ ZGUARD_MONITOR_API_URL: "https://x.example/" }).api, "https://x.example");
  assert.equal(settings({ PERM_MONITOR_URL: "" }).perm, "");
  assert.equal(settings({ ZGUARD_MONITOR_MIN_SWAPS: "abc" }).minSwaps, 5);
});
