//! ZGuard quote-match SP1 guest (gap C2 / H2).
//!
//! Built with the Succinct toolchain (`cargo prove build`, SP1 v6.10.0) in CI (`.github/workflows/sp1.yml`),
//! which also prints the `programVKey` (`sp1-host` `vkey`) and executes this ELF in the zkVM for every shared
//! TypeScript fixture (`sp1-host` `parity`). The rule logic lives in `../quote-rules` and is unit-tested
//! natively (`cargo test` there) against the same fixture file.
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
