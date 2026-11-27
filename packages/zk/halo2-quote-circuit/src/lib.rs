//! ZGuard quote-match in PSE Halo2-KZG (BN254, SHPLONK, Keccak transcript) — brief §8.3 path 2 / gap H7.
//!
//! What a proof states: for the canonical quote JSON `Q` and tx JSON `T` (eip3009 rail, see
//! [`template`]), `evaluate(Q, T, hints)` of `zguard-quote-rules` returns `(verdict, ruleBitmask)`.
//! The same rule engine runs in the SP1 guest, and the Solidity wrapper `ZGuardHalo2QuoteVerifier` returns
//! the same 160-byte public values `abi.encode(keccak("quote"), keccak(Q), keccak(T), verdict, mask)`.
//!
//! Design (why there is no keccak gadget): the JSON bytes are public inputs (31 bytes per field element).
//! The verifier contract hashes the calldata with the EVM's KECCAK256, packs the same bytes into the
//! instances and checks the proof, so `quoteHash`/`txHash` are bound exactly as in the SP1 path while the
//! circuit stays small (k = 13). The quote and tx JSON are therefore visible onchain; they hold the payment
//! fields (payTo, amount, asset, from, to), which the payment transaction exposes anyway.
//!
//! Proven from the bytes: Q-001 (payTo vs authorization.to, as 160-bit numbers, i.e. case-insensitive) and
//! Q-002 (amount vs value, as integers). Private hints, exactly as in SP1 (`hinted_mask`): Q-003, Q-004,
//! Q-006 and `domain_verified` (Q-007). Inputs outside the template (Q-005, Q-DECODE, other rails) have no
//! Halo2 proof and stay SP1-only.

pub mod template;

use halo2_proofs::{
    circuit::{AssignedCell, Layouter, Region, SimpleFloorPlanner, Value},
    halo2curves::bn256::Fr,
    plonk::{Advice, Circuit, Column, ConstraintSystem, Error, Expression, Fixed, Instance, Selector, TableColumn},
    poly::Rotation,
};
use template::{dfa, run, Tag};
pub use zguard_quote_rules::Hints;
use zguard_quote_rules::{ABSTAIN, ALLOW, DENY, Q001, Q002, Q003, Q004, Q006, Q007};

/// Circuit size: 2^K rows (lookup table ~2.7k rows, JSON regions 775 rows).
pub const K: u32 = 13;
/// Bytes per packed public input (big-endian, 31 bytes < 2^248 < r).
pub const CHUNK: usize = 31;
/// Region sizes; the JSON must be strictly shorter (at least one NUL padding byte).
pub const MAX_QUOTE: usize = 9 * CHUNK; // 279
pub const MAX_TX: usize = 16 * CHUNK; // 496
pub const QUOTE_CHUNKS: usize = MAX_QUOTE / CHUNK;
pub const TX_CHUNKS: usize = MAX_TX / CHUNK;
/// [quote chunks.., tx chunks.., verdict, mask]
pub const NUM_INSTANCES: usize = QUOTE_CHUNKS + TX_CHUNKS + 2;

#[derive(Clone, Debug)]
pub struct QuoteConfig {
    /// step rows: byte, state, is_addr, is_dec, val, addr_acc, dec_acc, pack
    adv: [Column<Advice>; 8],
    constants: Column<Fixed>,
    chunk_start: Column<Fixed>,
    q_step: Selector,
    q_verdict: Selector,
    instance: Column<Instance>,
    table: [TableColumn; 6],
}

/// Everything the prover knows for one JSON region.
#[derive(Clone, Debug)]
struct JsonTrace {
    bytes: Vec<u8>,
    states: Vec<u64>,
    tags: Vec<Tag>,
    addr: Vec<Fr>,
    dec: Vec<Fr>,
    pack: Vec<Fr>,
}

impl JsonTrace {
    fn new(bytes: &[u8], max: usize, start: u64, pad: u64) -> Option<Self> {
        // NUL is padding only; the verifier contract rejects JSON ending in NUL for the same reason.
        if bytes.contains(&0) {
            return None;
        }
        let (states, tags) = run(bytes, max, start, pad)?;
        let mut padded = bytes.to_vec();
        padded.resize(max, 0);
        let mut addr = vec![Fr::zero()];
        let mut dec = vec![Fr::zero()];
        let mut pack = Vec::with_capacity(max);
        for i in 0..max {
            let t = tags[i];
            let v = Fr::from(t.val as u64);
            let a = addr[i];
            let d = dec[i];
            addr.push(if t.is_addr { a * Fr::from(16) + v } else { a });
            dec.push(if t.is_dec { d * Fr::from(10) + v } else { d });
            let b = Fr::from(padded[i] as u64);
            pack.push(if i % CHUNK == 0 { b } else { pack[i - 1] * Fr::from(256) + b });
        }
        Some(Self { bytes: padded, states, tags, addr, dec, pack })
    }
}

/// Packs `bytes` (NUL-padded to `max`) into big-endian 31-byte field elements, as the contract does.
pub fn pack_bytes(bytes: &[u8], max: usize) -> Vec<Fr> {
    let mut padded = bytes.to_vec();
    padded.resize(max, 0);
    padded
        .chunks(CHUNK)
        .map(|c| c.iter().fold(Fr::zero(), |acc, &b| acc * Fr::from(256) + Fr::from(b as u64)))
        .collect()
}

/// Public inputs in circuit order.
pub fn instances(quote_json: &[u8], tx_json: &[u8], verdict: u8, mask: u32) -> Vec<Fr> {
    let mut out = pack_bytes(quote_json, MAX_QUOTE);
    out.extend(pack_bytes(tx_json, MAX_TX));
    out.push(Fr::from(verdict as u64));
    out.push(Fr::from(mask as u64));
    out
}

#[derive(Clone)]
struct Witness {
    quote: JsonTrace,
    tx: JsonTrace,
    hints: Hints,
}

/// Prover input. `QuoteCircuit::default()` is the witness-free shape used for key generation.
#[derive(Clone, Default)]
pub struct QuoteCircuit {
    witness: Option<Witness>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Outcome {
    pub verdict: u8,
    pub mask: u32,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CoverageError {
    /// Bytes are not canonical eip3009 JSON of the supported shape (Q-005 / Q-DECODE / other rails): SP1 only.
    OutsideTemplate(&'static str),
}

impl QuoteCircuit {
    pub fn new(quote_json: &[u8], tx_json: &[u8], hints: Hints) -> Result<Self, CoverageError> {
        let d = dfa();
        let quote = JsonTrace::new(quote_json, MAX_QUOTE, d.quote_start, d.quote_pad)
            .ok_or(CoverageError::OutsideTemplate("quote JSON"))?;
        let tx = JsonTrace::new(tx_json, MAX_TX, d.tx_start, d.tx_pad).ok_or(CoverageError::OutsideTemplate("tx JSON"))?;
        Ok(Self { witness: Some(Witness { quote, tx, hints }) })
    }

    /// The verdict this circuit enforces (same formula as the gate).
    pub fn outcome(&self) -> Outcome {
        let w = self.witness.as_ref().expect("witness");
        let q1 = w.quote.addr[MAX_QUOTE] != w.tx.addr[MAX_TX];
        let q2 = w.quote.dec[MAX_QUOTE] != w.tx.dec[MAX_TX];
        let h = w.hints;
        let denied = q1 || q2 || h.asset_mismatch || h.chain_mismatch || h.unexpected_approval;
        let abstain = !denied && !h.domain_verified;
        let mut mask = 0u32;
        if q1 {
            mask |= Q001;
        }
        if q2 {
            mask |= Q002;
        }
        if h.asset_mismatch {
            mask |= Q003;
        }
        if h.chain_mismatch {
            mask |= Q004;
        }
        if h.unexpected_approval {
            mask |= Q006;
        }
        if abstain {
            mask |= Q007;
        }
        let verdict = if denied { DENY } else if abstain { ABSTAIN } else { ALLOW };
        Outcome { verdict, mask }
    }

    pub fn instances(&self) -> Vec<Fr> {
        let w = self.witness.as_ref().expect("witness");
        let o = self.outcome();
        let mut out: Vec<Fr> = w.quote.pack.iter().skip(CHUNK - 1).step_by(CHUNK).copied().collect();
        out.extend(w.tx.pack.iter().skip(CHUNK - 1).step_by(CHUNK).copied());
        out.push(Fr::from(o.verdict as u64));
        out.push(Fr::from(o.mask as u64));
        out
    }
}

fn known<T, F: FnOnce(&T) -> Fr>(w: Option<&T>, f: F) -> Value<Fr> {
    match w {
        Some(x) => Value::known(f(x)),
        None => Value::unknown(),
    }
}

struct RegionOut {
    addr: AssignedCell<Fr, Fr>,
    dec: AssignedCell<Fr, Fr>,
    chunks: Vec<AssignedCell<Fr, Fr>>,
}

impl QuoteConfig {
    fn assign_json(
        &self,
        region: &mut Region<'_, Fr>,
        trace: Option<&JsonTrace>,
        max: usize,
        start: u64,
        pad: u64,
    ) -> Result<RegionOut, Error> {
        let [c_b, c_s, c_ia, c_id, c_v, c_aa, c_da, c_p] = self.adv;
        let mut chunks = Vec::new();
        // Row 0 only gives the packing gate a defined `pack[prev]` (multiplied by 0 at chunk starts).
        region.assign_advice(|| "pack guard", c_p, 0, || Value::known(Fr::zero()))?;
        for i in 0..max {
            let row = i + 1;
            self.q_step.enable(region, row)?;
            region.assign_fixed(|| "chunk start", self.chunk_start, row, || Value::known(Fr::from((i % CHUNK == 0) as u64)))?;
            region.assign_advice(|| "byte", c_b, row, || known(trace, |t| Fr::from(t.bytes[i] as u64)))?;
            let s = region.assign_advice(|| "state", c_s, row, || known(trace, |t| Fr::from(t.states[i])))?;
            region.assign_advice(|| "is_addr", c_ia, row, || known(trace, |t| Fr::from(t.tags[i].is_addr as u64)))?;
            region.assign_advice(|| "is_dec", c_id, row, || known(trace, |t| Fr::from(t.tags[i].is_dec as u64)))?;
            region.assign_advice(|| "val", c_v, row, || known(trace, |t| Fr::from(t.tags[i].val as u64)))?;
            let a = region.assign_advice(|| "addr", c_aa, row, || known(trace, |t| t.addr[i]))?;
            let d = region.assign_advice(|| "dec", c_da, row, || known(trace, |t| t.dec[i]))?;
            let p = region.assign_advice(|| "pack", c_p, row, || known(trace, |t| t.pack[i]))?;
            if i == 0 {
                region.constrain_constant(s.cell(), Fr::from(start))?;
                region.constrain_constant(a.cell(), Fr::zero())?;
                region.constrain_constant(d.cell(), Fr::zero())?;
            }
            if i % CHUNK == CHUNK - 1 {
                chunks.push(p);
            }
        }
        let s = region.assign_advice(|| "final state", c_s, max + 1, || known(trace, |t| Fr::from(t.states[max])))?;
        region.constrain_constant(s.cell(), Fr::from(pad))?;
        let addr = region.assign_advice(|| "final addr", c_aa, max + 1, || known(trace, |t| t.addr[max]))?;
        let dec = region.assign_advice(|| "final dec", c_da, max + 1, || known(trace, |t| t.dec[max]))?;
        Ok(RegionOut { addr, dec, chunks })
    }
}

impl Circuit<Fr> for QuoteCircuit {
    type Config = QuoteConfig;
    type FloorPlanner = SimpleFloorPlanner;

    fn without_witnesses(&self) -> Self {
        Self::default()
    }

    fn configure(meta: &mut ConstraintSystem<Fr>) -> QuoteConfig {
        let adv = [(); 8].map(|_| meta.advice_column());
        for c in adv {
            meta.enable_equality(c);
        }
        let constants = meta.fixed_column();
        meta.enable_constant(constants);
        let chunk_start = meta.fixed_column();
        let instance = meta.instance_column();
        meta.enable_equality(instance);
        let q_step = meta.complex_selector();
        let q_verdict = meta.selector();
        let table = [(); 6].map(|_| meta.lookup_table_column());
        let [c_b, c_s, c_ia, c_id, c_v, c_aa, c_da, c_p] = adv;

        // Every byte is a transition of the canonical-JSON automaton; the tag columns come from the table.
        meta.lookup("canonical json automaton", |m| {
            let q = m.query_selector(q_step);
            let cols = [
                m.query_advice(c_s, Rotation::cur()),
                m.query_advice(c_b, Rotation::cur()),
                m.query_advice(c_s, Rotation::next()),
                m.query_advice(c_ia, Rotation::cur()),
                m.query_advice(c_id, Rotation::cur()),
                m.query_advice(c_v, Rotation::cur()),
            ];
            cols.into_iter().zip(table).map(|(e, t)| (q.clone() * e, t)).collect()
        });

        meta.create_gate("accumulators and packing", |m| {
            let q = m.query_selector(q_step);
            let b = m.query_advice(c_b, Rotation::cur());
            let ia = m.query_advice(c_ia, Rotation::cur());
            let id = m.query_advice(c_id, Rotation::cur());
            let v = m.query_advice(c_v, Rotation::cur());
            let aa = m.query_advice(c_aa, Rotation::cur());
            let aa_n = m.query_advice(c_aa, Rotation::next());
            let da = m.query_advice(c_da, Rotation::cur());
            let da_n = m.query_advice(c_da, Rotation::next());
            let p = m.query_advice(c_p, Rotation::cur());
            let p_prev = m.query_advice(c_p, Rotation::prev());
            let cs = m.query_fixed(chunk_start, Rotation::cur());
            let c = |x: u64| Expression::Constant(Fr::from(x));
            vec![
                q.clone() * (aa_n - aa.clone() - ia * (c(15) * aa + v.clone())),
                q.clone() * (da_n - da.clone() - id * (c(9) * da + v)),
                q * (p - b - (c(1) - cs) * c(256) * p_prev),
            ]
        });

        // Verdict rows (r, r+1, r+2):
        //   r:   payTo, to, amount, value, inv_a, inv_d, eq_a, eq_d
        //   r+1: h_asset, h_chain, h_approval, h_domain, not_denied, abstain, verdict, mask
        //   r+2: m1 = eq_a*eq_d, m2 = (1-h_asset)(1-h_chain)
        meta.create_gate("quote-rules verdict", |m| {
            let q = m.query_selector(q_verdict);
            let mut a = |i: usize, r: i32| m.query_advice(adv[i], Rotation(r));
            let (aq, at, dq, dt, inv_a, inv_d, eq_a, eq_d) = (a(0, 0), a(1, 0), a(2, 0), a(3, 0), a(4, 0), a(5, 0), a(6, 0), a(7, 0));
            let (h3, h4, h6, hd, nd, ab, verdict, mask) = (a(0, 1), a(1, 1), a(2, 1), a(3, 1), a(4, 1), a(5, 1), a(6, 1), a(7, 1));
            let (m1, m2) = (a(0, 2), a(1, 2));
            let one = Expression::Constant(Fr::one());
            let c = |x: u64| Expression::Constant(Fr::from(x));
            let da = aq - at;
            let dd = dq - dt;
            let bool_ = |h: Expression<Fr>| h.clone() * (one.clone() - h);
            vec![
                eq_a.clone() + da.clone() * inv_a - one.clone(),
                da * eq_a.clone(),
                eq_d.clone() + dd.clone() * inv_d - one.clone(),
                dd * eq_d.clone(),
                bool_(h3.clone()),
                bool_(h4.clone()),
                bool_(h6.clone()),
                bool_(hd.clone()),
                m1.clone() - eq_a.clone() * eq_d.clone(),
                m2.clone() - (one.clone() - h3.clone()) * (one.clone() - h4.clone()),
                nd.clone() - m1 * m2 * (one.clone() - h6.clone()),
                ab.clone() - nd.clone() * (one.clone() - hd),
                verdict - (one.clone() + (one.clone() - nd) + c(2) * ab.clone()),
                mask - ((one.clone() - eq_a) + c(2) * (one - eq_d) + c(4) * h3 + c(8) * h4 + c(32) * h6 + c(64) * ab),
            ]
            .into_iter()
            .map(|e| q.clone() * e)
            .collect::<Vec<_>>()
        });

        QuoteConfig { adv, constants, chunk_start, q_step, q_verdict, instance, table }
    }

    fn synthesize(&self, cfg: QuoteConfig, mut layouter: impl Layouter<Fr>) -> Result<(), Error> {
        let d = dfa();
        layouter.assign_table(
            || "automaton",
            |mut t| {
                for (row, r) in d.table_rows().iter().enumerate() {
                    for (col, v) in cfg.table.iter().zip(r) {
                        t.assign_cell(|| "t", *col, row, || Value::known(Fr::from(*v)))?;
                    }
                }
                Ok(())
            },
        )?;

        let w = self.witness.as_ref();
        let q = layouter.assign_region(
            || "quote json",
            |mut r| cfg.assign_json(&mut r, w.map(|w| &w.quote), MAX_QUOTE, d.quote_start, d.quote_pad),
        )?;
        let t = layouter.assign_region(
            || "tx json",
            |mut r| cfg.assign_json(&mut r, w.map(|w| &w.tx), MAX_TX, d.tx_start, d.tx_pad),
        )?;

        let (verdict, mask) = layouter.assign_region(
            || "verdict",
            |mut r| {
                cfg.q_verdict.enable(&mut r, 0)?;
                let adv = cfg.adv;
                let wq = w.map(|w| (w.quote.addr[MAX_QUOTE], w.tx.addr[MAX_TX], w.quote.dec[MAX_QUOTE], w.tx.dec[MAX_TX], w.hints));
                let val = |f: &dyn Fn(Fr, Fr, Fr, Fr, Hints) -> Fr| match wq {
                    Some((a, b, c, e, h)) => Value::known(f(a, b, c, e, h)),
                    None => Value::unknown(),
                };
                let inv = |x: Fr| Option::<Fr>::from(x.invert()).unwrap_or(Fr::zero());
                let eq = |x: Fr, y: Fr| Fr::from((x == y) as u64);
                let fb = |b: bool| Fr::from(b as u64);

                let aq = r.assign_advice(|| "payTo", adv[0], 0, || val(&|a, _, _, _, _| a))?;
                let at = r.assign_advice(|| "to", adv[1], 0, || val(&|_, b, _, _, _| b))?;
                let dq = r.assign_advice(|| "amount", adv[2], 0, || val(&|_, _, c, _, _| c))?;
                let dt = r.assign_advice(|| "value", adv[3], 0, || val(&|_, _, _, e, _| e))?;
                r.constrain_equal(aq.cell(), q.addr.cell())?;
                r.constrain_equal(at.cell(), t.addr.cell())?;
                r.constrain_equal(dq.cell(), q.dec.cell())?;
                r.constrain_equal(dt.cell(), t.dec.cell())?;
                r.assign_advice(|| "inv_a", adv[4], 0, || val(&|a, b, _, _, _| inv(a - b)))?;
                r.assign_advice(|| "inv_d", adv[5], 0, || val(&|_, _, c, e, _| inv(c - e)))?;
                r.assign_advice(|| "eq_a", adv[6], 0, || val(&|a, b, _, _, _| eq(a, b)))?;
                r.assign_advice(|| "eq_d", adv[7], 0, || val(&|_, _, c, e, _| eq(c, e)))?;

                let nd_of = |a: Fr, b: Fr, c: Fr, e: Fr, h: Hints| {
                    fb(a == b && c == e && !h.asset_mismatch && !h.chain_mismatch && !h.unexpected_approval)
                };
                r.assign_advice(|| "h_asset", adv[0], 1, || val(&|_, _, _, _, h| fb(h.asset_mismatch)))?;
                r.assign_advice(|| "h_chain", adv[1], 1, || val(&|_, _, _, _, h| fb(h.chain_mismatch)))?;
                r.assign_advice(|| "h_approval", adv[2], 1, || val(&|_, _, _, _, h| fb(h.unexpected_approval)))?;
                r.assign_advice(|| "h_domain", adv[3], 1, || val(&|_, _, _, _, h| fb(h.domain_verified)))?;
                r.assign_advice(|| "not_denied", adv[4], 1, || val(&nd_of))?;
                r.assign_advice(|| "abstain", adv[5], 1, || {
                    val(&|a, b, c, e, h| nd_of(a, b, c, e, h) * fb(!h.domain_verified))
                })?;
                let out = self.witness.as_ref().map(|_| self.outcome());
                let verdict = r.assign_advice(|| "verdict", adv[6], 1, || {
                    out.as_ref().map(|o| Value::known(Fr::from(o.verdict as u64))).unwrap_or(Value::unknown())
                })?;
                let mask = r.assign_advice(|| "mask", adv[7], 1, || {
                    out.as_ref().map(|o| Value::known(Fr::from(o.mask as u64))).unwrap_or(Value::unknown())
                })?;
                r.assign_advice(|| "m1", adv[0], 2, || val(&|a, b, c, e, _| eq(a, b) * eq(c, e)))?;
                r.assign_advice(|| "m2", adv[1], 2, || {
                    val(&|_, _, _, _, h| fb(!h.asset_mismatch) * fb(!h.chain_mismatch))
                })?;
                Ok((verdict, mask))
            },
        )?;

        for (i, c) in q.chunks.iter().chain(t.chunks.iter()).enumerate() {
            layouter.constrain_instance(c.cell(), cfg.instance, i)?;
        }
        layouter.constrain_instance(verdict.cell(), cfg.instance, QUOTE_CHUNKS + TX_CHUNKS)?;
        layouter.constrain_instance(mask.cell(), cfg.instance, QUOTE_CHUNKS + TX_CHUNKS + 1)?;
        let _ = cfg.constants;
        Ok(())
    }
}

pub mod prover;
