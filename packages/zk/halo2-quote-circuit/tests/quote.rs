//! Native tests: the circuit agrees with `zguard-quote-rules` (and therefore the SP1 guest and the TS SDK)
//! on the shared fixtures and on extra edge cases, rejects wrong public inputs, and a real KZG proof
//! verifies with the pinned SRS.

use halo2_proofs::{dev::MockProver, halo2curves::bn256::Fr};
use serde_json::Value;
use zguard_halo2_quote_circuit::{instances, CoverageError, Hints, QuoteCircuit, K, NUM_INSTANCES};
use zguard_quote_rules::{evaluate, public_values, ALLOW, DENY, Q001, Q002, Q007};

const FIXTURES: &str = include_str!("../../fixtures/sp1-quote-fixtures.json");

fn fixtures() -> Vec<Value> {
    serde_json::from_str(FIXTURES).unwrap()
}

fn hints_of(f: &Value) -> Hints {
    let h = &f["hints"];
    let b = |k: &str| h[k].as_bool().unwrap();
    Hints {
        asset_mismatch: b("asset_mismatch"),
        chain_mismatch: b("chain_mismatch"),
        unexpected_approval: b("unexpected_approval"),
        domain_verified: b("domain_verified"),
    }
}

fn mock_ok(c: &QuoteCircuit, inst: Vec<Fr>) -> bool {
    let r = MockProver::run(K, c, vec![inst]).unwrap().verify();
    if std::env::var("DEBUG_MOCK").is_ok() {
        if let Err(e) = &r {
            for x in e.iter().take(5) {
                eprintln!("{x}");
            }
        }
    }
    r.is_ok()
}

/// Circuit outcome == quote-rules, MockProver accepts the honest instances and rejects tampered ones.
fn check(q: &str, tx: &str, hints: Hints) -> (u8, u32) {
    let reference = evaluate(q.as_bytes(), tx.as_bytes(), hints);
    let c = QuoteCircuit::new(q.as_bytes(), tx.as_bytes(), hints).expect("covered");
    let o = c.outcome();
    assert_eq!((o.verdict, o.mask), (reference.verdict, reference.rule_bitmask));
    let inst = c.instances();
    assert_eq!(inst.len(), NUM_INSTANCES);
    assert_eq!(inst, instances(q.as_bytes(), tx.as_bytes(), o.verdict, o.mask));
    assert!(mock_ok(&c, inst.clone()), "honest instances rejected");

    let n = inst.len();
    for wrong in [ALLOW, DENY, 3u8] {
        if wrong != o.verdict {
            let mut bad = inst.clone();
            bad[n - 2] = Fr::from(wrong as u64);
            assert!(!mock_ok(&c, bad), "accepted wrong verdict {wrong}");
        }
    }
    let mut bad = inst.clone();
    bad[n - 1] = Fr::from((o.mask ^ Q001) as u64);
    assert!(!mock_ok(&c, bad), "accepted wrong mask");
    let mut bad = inst.clone();
    bad[0] += Fr::one();
    assert!(!mock_ok(&c, bad), "accepted different quote bytes");
    let mut bad = inst;
    bad[n - 3] += Fr::one();
    assert!(!mock_ok(&c, bad), "accepted different tx bytes");
    (o.verdict, o.mask)
}

#[test]
fn shared_fixtures_match_quote_rules() {
    let mut covered = 0;
    for f in fixtures() {
        let name = f["name"].as_str().unwrap();
        let q = f["quoteJson"].as_str().unwrap();
        let tx = f["txJson"].as_str().unwrap();
        let hints = hints_of(&f);
        let pv = format!("0x{}", hex::encode(public_values(&evaluate(q.as_bytes(), tx.as_bytes(), hints))));
        assert_eq!(pv, f["expectedPublicValues"].as_str().unwrap(), "{name}");
        match QuoteCircuit::new(q.as_bytes(), tx.as_bytes(), hints) {
            Ok(_) => {
                let (v, _) = check(q, tx, hints);
                let ts = match f["tsVerdict"].as_str().unwrap() {
                    "allow" => 1,
                    "deny" => 2,
                    _ => 3,
                };
                assert_eq!(v, ts, "{name}");
                covered += 1;
            }
            Err(CoverageError::OutsideTemplate(_)) => {
                // Only Q-005 (no quote) and Q-DECODE (non-eip3009) fixtures may fall outside the template.
                assert!(name.contains("q005") || name.contains("qdecode"), "{name} unexpectedly not covered");
            }
        }
    }
    assert_eq!(covered, 5);
}

fn base() -> (String, String) {
    let f = &fixtures()[0];
    (f["quoteJson"].as_str().unwrap().to_string(), f["txJson"].as_str().unwrap().to_string())
}

const OK: Hints = Hints { asset_mismatch: false, chain_mismatch: false, unexpected_approval: false, domain_verified: true };

#[test]
fn amounts_compare_as_integers() {
    let (q, tx) = base();
    let big = "1".repeat(38);
    let tx_big = tx.replace("\"value\":\"15000\"", &format!("\"value\":\"{big}\""));
    let q_big = q.replace("\"amount\":\"15000\"", &format!("\"amount\":\"{big}\""));
    assert_eq!(check(&q_big, &tx_big, OK), (ALLOW, 0));
    assert_eq!(check(&q, &tx_big, OK), (DENY, Q002));
    // Leading zeros: quote-rules parses to u128, so "015000" == "15000".
    let q_lead = q.replace("\"amount\":\"15000\"", "\"amount\":\"015000\"");
    assert_eq!(check(&q_lead, &tx, OK), (ALLOW, 0));
    let tx_zero = tx.replace("\"value\":\"15000\"", "\"value\":\"0\"");
    assert_eq!(check(&q, &tx_zero, OK), (DENY, Q002));
}

#[test]
fn recipient_and_hints() {
    let (q, tx) = base();
    let tx_other = tx.replace("\"to\":\"0xad55", "\"to\":\"0xad56");
    assert_eq!(check(&q, &tx_other, OK), (DENY, Q001));
    let tx_both = tx_other.replace("\"value\":\"15000\"", "\"value\":\"15001\"");
    let h = Hints { unexpected_approval: true, chain_mismatch: true, ..OK };
    let (v, m) = check(&q, &tx_both, h);
    assert_eq!(v, DENY);
    assert_eq!(m, Q001 | Q002 | (1 << 3) | (1 << 5));
    let h = Hints { domain_verified: false, ..OK };
    assert_eq!(check(&q, &tx, h), (3, Q007));
    // Deny wins over the Q-007 abstain, exactly like quote-rules.
    assert_eq!(check(&q, &tx_other, h), (DENY, Q001));
}

#[test]
fn tx_variants_inside_template() {
    let (q, tx) = base();
    let receive = tx.replace("TransferWithAuthorization", "ReceiveWithAuthorization");
    assert_eq!(check(&q, &receive, OK), (ALLOW, 0));
    let no_before = tx.replace("\"validBefore\":\"4102444800\"", "\"validBefore\":null");
    assert_eq!(check(&q, &no_before, OK), (ALLOW, 0));
    let empty_nonce = tx.replace(&format!("\"nonce\":\"0x{}\"", "1".repeat(64)), "\"nonce\":\"\"");
    assert_eq!(check(&q, &empty_nonce, OK), (ALLOW, 0));
}

#[test]
fn rejects_non_canonical_or_out_of_scope() {
    let (q, tx) = base();
    let bad = |q: &str, tx: &str| QuoteCircuit::new(q.as_bytes(), tx.as_bytes(), OK).is_err();
    assert!(bad(&q.replace("0xad55", "0xAD55"), &tx), "uppercase hex is not canonical");
    assert!(bad(&q.replace("{\"intent\":null,", "{\"intent\":null, "), &tx), "whitespace");
    assert!(bad(&q, &tx.replace("\"value\":\"15000\"", &format!("\"value\":\"{}\"", "9".repeat(39)))), "> u128");
    assert!(bad(&q, &tx.replace("\"value\":\"15000\"", "\"value\":\"\"")), "empty amount = Q-DECODE");
    assert!(bad(&format!("{q}\0"), &tx), "embedded NUL");
    assert!(bad(&q, &tx.replace("eip3009", "permit2")), "other rail");
    assert!(bad(&q, &format!("{}{}", tx, " ".repeat(200))), "too long");
}

/// Real KZG prove/verify with the pinned PPoT-derived SRS. Skips when the SRS is absent unless
/// ZGUARD_HALO2_REQUIRE_SRS=1 (set in CI).
#[test]
fn real_kzg_proof_with_pinned_srs() {
    use zguard_halo2_quote_circuit::prover::{default_srs_path, keygen, load_params, prove, verify};
    let params = match load_params(default_srs_path()) {
        Ok(p) => p,
        Err(e) if std::env::var("ZGUARD_HALO2_REQUIRE_SRS").as_deref() != Ok("1") => {
            eprintln!("skipping real proof: {e}");
            return;
        }
        Err(e) => panic!("{e}"),
    };
    let pk = keygen(&params);
    let f = &fixtures()[1]; // deny-q001-recipient
    let c = QuoteCircuit::new(f["quoteJson"].as_str().unwrap().as_bytes(), f["txJson"].as_str().unwrap().as_bytes(), hints_of(f)).unwrap();
    let inst = c.instances();
    let proof = prove(&params, &pk, c);
    assert!(verify(&params, pk.get_vk(), &proof, &inst));
    let mut forged = inst.clone();
    let n = forged.len();
    forged[n - 2] = Fr::from(ALLOW as u64);
    forged[n - 1] = Fr::zero();
    assert!(!verify(&params, pk.get_vk(), &proof, &forged), "proof re-used for allow");
}
