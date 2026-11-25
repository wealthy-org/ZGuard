//! ZGuard quote-match rules for the SP1 guest (gap C2).
//!
//! Inputs are the SAME canonical JSON strings the TypeScript SDK hashes in
//! `computeQuoteAndTxCommitments` (`canonicalQuoteAndTxJson`), so `quoteHash`/`txHash` committed by the
//! guest equal the values in ZGuard's API attestation, and the public values equal
//! `encodeQuotePublicValues` byte-for-byte (see the cross-language vector test below).
//!
//! What is PROVEN from the committed JSON (eip3009 rail): Q-005 (no quote), Q-DECODE (unparseable),
//! Q-001 (recipient), Q-002 (amount).
//! What is only a private HINT (not proven, reported in `hinted_mask`): Q-003/Q-004 (the EIP-712 domain
//! is not part of the canonical tx JSON), Q-006, Q-007 (onchain domain lookup). Intent / evm_tx rails
//! are not implemented in the guest yet and yield Q-DECODE.
#![no_std]
extern crate alloc;

use alloc::vec::Vec;
use serde_json::Value;
use tiny_keccak::{Hasher, Keccak};

pub const Q001: u32 = 1 << 0;
pub const Q002: u32 = 1 << 1;
pub const Q003: u32 = 1 << 2;
pub const Q004: u32 = 1 << 3;
pub const Q005: u32 = 1 << 4;
pub const Q006: u32 = 1 << 5;
pub const Q007: u32 = 1 << 6;
pub const QDECODE: u32 = 1 << 7;

pub const ALLOW: u8 = 1;
pub const DENY: u8 = 2;
pub const ABSTAIN: u8 = 3;

pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut k = Keccak::v256();
    k.update(data);
    let mut out = [0u8; 32];
    k.finalize(&mut out);
    out
}

/// Private hints the host supplies for checks that cannot (yet) be derived from the committed JSON.
#[derive(Clone, Copy, Default)]
pub struct Hints {
    pub asset_mismatch: bool,
    pub chain_mismatch: bool,
    pub unexpected_approval: bool,
    pub domain_verified: bool,
}

pub struct Verdict {
    pub quote_hash: [u8; 32],
    pub tx_hash: [u8; 32],
    pub verdict: u8,
    pub rule_bitmask: u32,
    /// Bits that came from `Hints` rather than from the committed JSON.
    pub hinted_mask: u32,
}

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

fn parse_u128(s: &str) -> Option<u128> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

pub fn evaluate(quote_json: &[u8], tx_json: &[u8], hints: Hints) -> Verdict {
    let quote_hash = keccak256(quote_json);
    let tx_hash = keccak256(tx_json);
    let done = |verdict: u8, mask: u32, hinted: u32| Verdict {
        quote_hash,
        tx_hash,
        verdict,
        rule_bitmask: mask,
        hinted_mask: hinted,
    };

    let (q, t): (Value, Value) = match (serde_json::from_slice(quote_json), serde_json::from_slice(tx_json)) {
        (Ok(q), Ok(t)) => (q, t),
        _ => return done(ABSTAIN, QDECODE, 0),
    };
    let quote = match q.get("quote") {
        Some(v) if v.is_object() => v,
        _ => return done(DENY, Q005, 0),
    };
    let payload = match t.get("payload") {
        Some(v) if v.is_object() => v,
        _ => return done(ABSTAIN, QDECODE, 0),
    };
    if str_field(payload, "type") != Some("eip3009") {
        return done(ABSTAIN, QDECODE, 0);
    }
    let auth = match payload.get("authorization") {
        Some(a) if a.is_object() => a,
        _ => return done(ABSTAIN, QDECODE, 0),
    };
    let (pay_to, amount, to, value) = match (
        str_field(quote, "payTo"),
        str_field(quote, "amount").and_then(parse_u128),
        str_field(auth, "to"),
        str_field(auth, "value").and_then(parse_u128),
    ) {
        (Some(p), Some(a), Some(to), Some(v)) => (p, a, to, v),
        _ => return done(ABSTAIN, QDECODE, 0),
    };

    let mut mask = 0u32;
    if !pay_to.eq_ignore_ascii_case(to) {
        mask |= Q001;
    }
    if amount != value {
        mask |= Q002;
    }
    let mut hinted = 0u32;
    if hints.asset_mismatch {
        hinted |= Q003;
    }
    if hints.chain_mismatch {
        hinted |= Q004;
    }
    if hints.unexpected_approval {
        hinted |= Q006;
    }
    mask |= hinted;
    if mask != 0 {
        return done(DENY, mask, hinted);
    }
    if !hints.domain_verified {
        return done(ABSTAIN, Q007, Q007);
    }
    done(ALLOW, 0, 0)
}

/// abi.encode(bytes32 scopeHash, bytes32 quoteHash, bytes32 txHash, uint8 verdict, uint32 ruleBitmask)
pub fn public_values(v: &Verdict) -> Vec<u8> {
    let mut out = Vec::with_capacity(160);
    out.extend_from_slice(&keccak256(b"quote"));
    out.extend_from_slice(&v.quote_hash);
    out.extend_from_slice(&v.tx_hash);
    let mut w = [0u8; 32];
    w[31] = v.verdict;
    out.extend_from_slice(&w);
    let mut m = [0u8; 32];
    m[28..].copy_from_slice(&v.rule_bitmask.to_be_bytes());
    out.extend_from_slice(&m);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // Vectors produced by the TypeScript SDK (`canonicalQuoteAndTxJson`, `computeQuoteAndTxCommitments`,
    // `encodeQuotePublicValues`) for a quote to 0x…aaaa and an authorization to 0x…bbbb (deny Q-001).
    const QUOTE_JSON: &str = r#"{"intent":null,"network":"eip155:46630","quote":{"amount":"1000","asset":"0x7e955252e15c84f5768b83c41a71f9eba181802f","chainId":"46630","payTo":"0x000000000000000000000000000000000000aaaa"}}"#;
    const TX_JSON: &str = r#"{"network":"eip155:46630","payload":{"authorization":{"from":"0x000000000000000000000000000000000000aaaa","kind":"TransferWithAuthorization","nonce":"","to":"0x000000000000000000000000000000000000bbbb","validAfter":"0","validBefore":null,"value":"1000"},"intent":null,"tx":null,"type":"eip3009"}}"#;
    const TS_QUOTE_HASH: &str = "00cfe0ab4f1ac2cdb81003938f9f669ce7c5600277acb3a1a79770b873c86366";
    const TS_TX_HASH: &str = "fb13dc230e9b6f81bd7b16f9d78db9a8024ff32b3460b252cb2f06c3271799b7";
    const TS_PUBLIC_VALUES: &str = "238ad53218834f943da60c8bafd36c36692dcb35e6d76bdd93202f5c04c0baff00cfe0ab4f1ac2cdb81003938f9f669ce7c5600277acb3a1a79770b873c86366fb13dc230e9b6f81bd7b16f9d78db9a8024ff32b3460b252cb2f06c3271799b700000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001";

    fn hex(b: &[u8]) -> alloc::string::String {
        use core::fmt::Write;
        let mut s = alloc::string::String::new();
        for x in b {
            write!(s, "{:02x}", x).unwrap();
        }
        s
    }

    #[test]
    fn commitments_match_typescript() {
        let v = evaluate(QUOTE_JSON.as_bytes(), TX_JSON.as_bytes(), Hints { domain_verified: true, ..Default::default() });
        assert_eq!(hex(&v.quote_hash), TS_QUOTE_HASH);
        assert_eq!(hex(&v.tx_hash), TS_TX_HASH);
    }

    #[test]
    fn deny_q001_public_values_match_typescript() {
        let v = evaluate(QUOTE_JSON.as_bytes(), TX_JSON.as_bytes(), Hints { domain_verified: true, ..Default::default() });
        assert_eq!(v.verdict, DENY);
        assert_eq!(v.rule_bitmask, Q001);
        assert_eq!(v.hinted_mask, 0);
        assert_eq!(hex(&public_values(&v)), TS_PUBLIC_VALUES);
    }

    #[test]
    fn allow_requires_domain_hint() {
        let tx = TX_JSON.replace("0x000000000000000000000000000000000000bbbb", "0x000000000000000000000000000000000000AAAA");
        let ok = evaluate(QUOTE_JSON.as_bytes(), tx.as_bytes(), Hints { domain_verified: true, ..Default::default() });
        assert_eq!((ok.verdict, ok.rule_bitmask), (ALLOW, 0));
        let ab = evaluate(QUOTE_JSON.as_bytes(), tx.as_bytes(), Hints::default());
        assert_eq!((ab.verdict, ab.rule_bitmask, ab.hinted_mask), (ABSTAIN, Q007, Q007));
    }

    #[test]
    fn amount_mismatch_q002_and_missing_quote_q005_and_garbage_qdecode() {
        let tx = TX_JSON.replace("\"value\":\"1000\"", "\"value\":\"999\"").replace("bbbb", "aaaa");
        let v = evaluate(QUOTE_JSON.as_bytes(), tx.as_bytes(), Hints { domain_verified: true, ..Default::default() });
        assert_eq!((v.verdict, v.rule_bitmask), (DENY, Q002));

        let noq = r#"{"intent":null,"network":"eip155:46630","quote":null}"#;
        let v = evaluate(noq.as_bytes(), TX_JSON.as_bytes(), Hints::default());
        assert_eq!((v.verdict, v.rule_bitmask), (DENY, Q005));

        let v = evaluate(b"not json", TX_JSON.as_bytes(), Hints::default());
        assert_eq!((v.verdict, v.rule_bitmask), (ABSTAIN, QDECODE));
    }

    #[test]
    fn hinted_bits_are_reported_separately() {
        let tx = TX_JSON.replace("bbbb", "aaaa");
        let v = evaluate(
            QUOTE_JSON.as_bytes(),
            tx.as_bytes(),
            Hints { asset_mismatch: true, domain_verified: true, ..Default::default() },
        );
        assert_eq!((v.verdict, v.rule_bitmask, v.hinted_mask), (DENY, Q003, Q003));
    }
}
