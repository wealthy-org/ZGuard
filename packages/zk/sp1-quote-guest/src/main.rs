#![no_main]
sp1_zkvm::entrypoint!(main);

use alloy_sol_types::{sol, SolValue};
use serde::{Deserialize, Serialize};
use tiny_keccak::{Hasher, Keccak};

sol! {
    /// Public outputs committed on Robinhood Chain 4663 (§8.3 Dev Brief).
    /// Raw intent/quote values stay private inside zkVM witness; only commitments are exposed.
    struct PublicQuoteVerdict {
        bytes32 scopeHash;    // always keccak256("quote")
        bytes32 quoteHash;    // commitment to quoted payment / router intent
        bytes32 txHash;       // commitment to candidate authorization / tx
        uint8 verdict;        // 1 = allow, 2 = deny, 3 = abstain
        uint32 ruleBitmask;   // bitflags for Q-001..Q-007, Q-DECODE, P-401, P-UNAVAIL
    }
}

#[derive(Serialize, Deserialize)]
pub struct QuoteWitness {
    pub has_quote: bool,
    pub decodable: bool,
    pub domain_verified: bool,
    pub has_unexpected_approval: bool,
    pub expected_pay_to: [u8; 20],
    pub actual_pay_to: [u8; 20],
    pub expected_asset: [u8; 20],
    pub actual_asset: [u8; 20],
    pub expected_amount: u128,
    pub actual_amount: u128,
    pub expected_chain_id: u64,
    pub actual_chain_id: u64,
    pub witness_salt: [u8; 32],
}

fn keccak256_bytes(chunks: &[&[u8]]) -> [u8; 32] {
    let mut k = Keccak::v256();
    for c in chunks {
        k.update(c);
    }
    let mut out = [0u8; 32];
    k.finalize(&mut out);
    out
}

pub fn main() {
    let w: QuoteWitness = sp1_zkvm::io::read();

    let scope_hash = keccak256_bytes(&[b"quote"]);
    let quote_hash = keccak256_bytes(&[
        &w.expected_pay_to,
        &w.expected_asset,
        &w.expected_amount.to_be_bytes(),
        &w.expected_chain_id.to_be_bytes(),
        &w.witness_salt,
    ]);
    let tx_hash = keccak256_bytes(&[
        &w.actual_pay_to,
        &w.actual_asset,
        &w.actual_amount.to_be_bytes(),
        &w.actual_chain_id.to_be_bytes(),
        &w.witness_salt,
    ]);

    let mut rule_bitmask: u32 = 0;
    let verdict: u8;

    if !w.has_quote {
        rule_bitmask |= 1 << 4; // Q-005
        verdict = 2; // deny
    } else if !w.decodable {
        rule_bitmask |= 1 << 7; // Q-DECODE
        verdict = 3; // abstain
    } else {
        if w.actual_pay_to != w.expected_pay_to {
            rule_bitmask |= 1 << 0; // Q-001
        }
        if w.actual_amount != w.expected_amount {
            rule_bitmask |= 1 << 1; // Q-002
        }
        if w.actual_asset != w.expected_asset {
            rule_bitmask |= 1 << 2; // Q-003
        }
        if w.actual_chain_id != w.expected_chain_id {
            rule_bitmask |= 1 << 3; // Q-004
        }
        if w.has_unexpected_approval {
            rule_bitmask |= 1 << 5; // Q-006
        }

        if rule_bitmask != 0 {
            verdict = 2; // deny
        } else if !w.domain_verified {
            rule_bitmask |= 1 << 6; // Q-007
            verdict = 3; // abstain
        } else {
            verdict = 1; // allow
        }
    }

    let public_out = PublicQuoteVerdict {
        scopeHash: scope_hash.into(),
        quoteHash: quote_hash.into(),
        txHash: tx_hash.into(),
        verdict,
        ruleBitmask: rule_bitmask,
    };

    sp1_zkvm::io::commit_slice(&public_out.abi_encode());
}
