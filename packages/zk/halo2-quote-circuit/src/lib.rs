//! STATUS: SKELETON ONLY (gap C2). This circuit is not wired into the API, has no prover, no verifier
//! contract and no tests. Its commitments are NOT the keccak(canonical JSON) commitments used by ZGuard
//! attestations, so nothing produced here can be checked onchain. Do not describe Halo2 as available.
//!
//! Hand-written Halo2-KZG circuit for ZGuard quote-match (§8.3 Path 2).
//! Compares (payTo, amount, asset, chainId) against the 402 quote without a zkVM
//! and exposes the exact same public input structure as Path 1 (Groth16-SP1):
//! [quoteHash, txHash, verdict, ruleBitmask].

use ff::PrimeField;
use halo2_proofs::{
    circuit::{Layouter, SimpleFloorPlanner, Value},
    plonk::{Advice, Circuit, Column, ConstraintSystem, Error, Expression, Instance, Selector},
    poly::Rotation,
};

#[derive(Clone, Debug)]
pub struct QuoteMatchConfig {
    pub expected: [Column<Advice>; 4], // payTo, amount, asset, chainId
    pub actual: [Column<Advice>; 4],
    pub diff_inv: [Column<Advice>; 4],
    pub mismatch_flag: [Column<Advice>; 4],
    pub public_inputs: Column<Instance>,
    pub q_quote: Selector,
}

#[derive(Clone, Default)]
pub struct QuoteMatchCircuit<F: PrimeField> {
    pub expected_fields: [Value<F>; 4],
    pub actual_fields: [Value<F>; 4],
    pub quote_commitment: Value<F>,
    pub tx_commitment: Value<F>,
}

impl<F: PrimeField> Circuit<F> for QuoteMatchCircuit<F> {
    type Config = QuoteMatchConfig;
    type FloorPlanner = SimpleFloorPlanner;

    fn without_witnesses(&self) -> Self {
        Self::default()
    }

    fn configure(meta: &mut ConstraintSystem<F>) -> Self::Config {
        let expected = [
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
        ];
        let actual = [
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
        ];
        let diff_inv = [
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
        ];
        let mismatch_flag = [
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
        ];
        let public_inputs = meta.instance_column();
        meta.enable_equality(public_inputs);
        for c in &mismatch_flag {
            meta.enable_equality(*c);
        }

        let q_quote = meta.selector();

        // IsZero / IsMismatch gate for each of the 4 fields (Q-001..Q-004):
        // flag ∈ {0, 1}, (expected - actual) * (1 - flag) == 0, and if flag == 1 then (expected - actual) * inv == 1
        meta.create_gate("quote_field_parity", |meta| {
            let q = meta.query_selector(q_quote);
            let one = Expression::Constant(F::ONE);
            let mut constraints = Vec::with_capacity(12);

            for i in 0..4 {
                let exp = meta.query_advice(expected[i], Rotation::cur());
                let act = meta.query_advice(actual[i], Rotation::cur());
                let inv = meta.query_advice(diff_inv[i], Rotation::cur());
                let flg = meta.query_advice(mismatch_flag[i], Rotation::cur());
                let diff = exp - act;

                // Booleanity of mismatch flag
                constraints.push(q.clone() * flg.clone() * (one.clone() - flg.clone()));
                // If flag == 0, diff must be 0
                constraints.push(q.clone() * diff.clone() * (one.clone() - flg.clone()));
                // If flag == 1, diff * inv == 1
                constraints.push(q.clone() * (diff * inv - flg));
            }
            constraints
        });

        QuoteMatchConfig {
            expected,
            actual,
            diff_inv,
            mismatch_flag,
            public_inputs,
            q_quote,
        }
    }

    fn synthesize(
        &self,
        config: Self::Config,
        mut layouter: impl Layouter<F>,
    ) -> Result<(), Error> {
        layouter.assign_region(
            || "quote_match_row",
            |mut region| {
                config.q_quote.enable(&mut region, 0)?;
                for i in 0..4 {
                    region.assign_advice(|| "expected", config.expected[i], 0, || self.expected_fields[i])?;
                    region.assign_advice(|| "actual", config.actual[i], 0, || self.actual_fields[i])?;

                    let diff = self.expected_fields[i] - self.actual_fields[i];
                    let inv = diff.map(|d| d.invert().unwrap_or(F::ZERO));
                    let flag = diff.map(|d| if bool::from(d.is_zero()) { F::ZERO } else { F::ONE });

                    region.assign_advice(|| "diff_inv", config.diff_inv[i], 0, || inv)?;
                    region.assign_advice(|| "mismatch_flag", config.mismatch_flag[i], 0, || flag)?;
                }
                Ok(())
            },
        )
    }
}
