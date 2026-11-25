//! ZGuard quote-match SP1 guest — SCAFFOLD (gap C2).
//!
//! Status: compiles only with the Succinct toolchain (`cargo prove build`), which is not available in
//! this repository's CI. The rule logic lives in `../quote-rules` and IS unit-tested natively
//! (`cargo test` there), including a cross-language vector proving that the committed public values
//! equal the TypeScript `encodeQuotePublicValues` output byte-for-byte.
//!
//! Inputs (in order):
//!   1. canonical quote JSON bytes  (TS `canonicalQuoteAndTxJson().quoteJson`)
//!   2. canonical tx JSON bytes     (TS `canonicalQuoteAndTxJson().txJson`)
//!   3. hints: asset_mismatch, chain_mismatch, unexpected_approval, domain_verified (bools, NOT proven)
//! Output: abi.encode(scopeHash, quoteHash, txHash, uint8 verdict, uint32 ruleBitmask), consumed by
//! `ZGuardQuoteVerifier.verifySp1QuoteProof`.
#![no_main]
sp1_zkvm::entrypoint!(main);

use zguard_quote_rules::{evaluate, public_values, Hints};

pub fn main() {
    let quote_json: Vec<u8> = sp1_zkvm::io::read();
    let tx_json: Vec<u8> = sp1_zkvm::io::read();
    let hints = Hints {
        asset_mismatch: sp1_zkvm::io::read(),
        chain_mismatch: sp1_zkvm::io::read(),
        unexpected_approval: sp1_zkvm::io::read(),
        domain_verified: sp1_zkvm::io::read(),
    };
    let verdict = evaluate(&quote_json, &tx_json, hints);
    sp1_zkvm::io::commit_slice(&public_values(&verdict));
}
