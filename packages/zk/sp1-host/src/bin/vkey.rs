//! Prints the SP1 program verification key (bytes32) of the ZGuard quote guest.
//! This is the `programVKey` the onchain `ZGuardQuoteVerifier` must be configured with (gap H2).
//!   cargo run --release --bin vkey
use sp1_sdk::{blocking::MockProver, blocking::Prover, include_elf, Elf, HashableKey, ProvingKey};

const GUEST_ELF: Elf = include_elf!("zguard-sp1-quote-guest");

fn main() {
    let prover = MockProver::new();
    let pk = prover.setup(GUEST_ELF).expect("failed to setup elf");
    println!("{}", pk.verifying_key().bytes32());
}
