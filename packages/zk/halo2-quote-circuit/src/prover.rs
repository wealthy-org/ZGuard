//! Key generation, proving, native verification and Solidity verifier generation.
//!
//! SRS: `kzg_bn254_13.srs` from Axiom's KZG setup derived from the Perpetual Powers of Tau ceremony
//! (challenge 0085), downloaded from `SRS_URL` and pinned by SHA-256. `ParamsKZG::setup` (toxic waste known)
//! is never used outside `#[cfg(test)]` helpers.

use std::{fs::File, io::BufReader, path::Path};

use halo2_proofs::{
    halo2curves::{
        bn256::{pairing, Bn256, Fr, G1Affine},
    },
    plonk::{create_proof, keygen_pk, keygen_vk_custom, verify_proof, ProvingKey, VerifyingKey},
    poly::{
        commitment::{Params, ParamsProver},
        kzg::{
            commitment::{KZGCommitmentScheme, ParamsKZG},
            multiopen::{ProverSHPLONK, VerifierSHPLONK},
            strategy::SingleStrategy,
        },
    },
    transcript::TranscriptWriterBuffer,
    SerdeFormat,
};
use halo2_solidity_verifier::{BatchOpenScheme, Keccak256Transcript, SolidityGenerator};
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};

use crate::{QuoteCircuit, K, NUM_INSTANCES};

pub const SRS_URL: &str = "https://axiom-crypto.s3.amazonaws.com/challenge_0085/kzg_bn254_13.srs";
pub const SRS_SHA256: &str = "ff7e044c842f4a2b1bb889618e5b4e8e15268f8c589b5c37f628f528b4969a02";

/// Default location: `$ZGUARD_HALO2_SRS` or `<crate>/srs/kzg_bn254_13.srs` (gitignored, fetched by
/// `scripts/fetch-halo2-srs.sh`).
pub fn default_srs_path() -> String {
    std::env::var("ZGUARD_HALO2_SRS")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/srs/kzg_bn254_13.srs").to_string())
}

/// Loads the pinned SRS; refuses any file whose hash differs.
pub fn load_params(path: impl AsRef<Path>) -> Result<ParamsKZG<Bn256>, String> {
    let path = path.as_ref();
    let bytes = std::fs::read(path).map_err(|e| format!("cannot read SRS {}: {e} (run scripts/fetch-halo2-srs.sh)", path.display()))?;
    let digest = hex::encode(Sha256::digest(&bytes));
    if digest != SRS_SHA256 {
        return Err(format!("SRS hash mismatch: {digest} != {SRS_SHA256}"));
    }
    let params = ParamsKZG::<Bn256>::read_custom(&mut BufReader::new(File::open(path).map_err(|e| e.to_string())?), SerdeFormat::RawBytes)
        .map_err(|e| format!("SRS decode: {e}"))?;
    if params.k() != K {
        return Err(format!("SRS k={} but circuit needs k={K}", params.k()));
    }
    // Structure spot-check: g[0] = G1 generator and e(g[i+1], g2) == e(g[i], s*g2), i.e. same tau.
    let g = params.get_g();
    if g[0] != G1Affine::generator() {
        return Err("SRS g[0] is not the BN254 G1 generator".into());
    }
    for i in [0usize, 1, 4095, g.len() - 2] {
        if pairing(&g[i + 1], &params.g2()) != pairing(&g[i], &params.s_g2()) {
            return Err(format!("SRS powers inconsistent at {i}"));
        }
    }
    Ok(params)
}

pub fn keygen(params: &ParamsKZG<Bn256>) -> ProvingKey<G1Affine> {
    let shape = QuoteCircuit::default();
    let vk = keygen_vk_custom(params, &shape, false).expect("keygen_vk");
    keygen_pk(params, vk, &shape).expect("keygen_pk")
}

pub fn prove(params: &ParamsKZG<Bn256>, pk: &ProvingKey<G1Affine>, circuit: QuoteCircuit) -> Vec<u8> {
    let instances = circuit.instances();
    let mut transcript = Keccak256Transcript::new(Vec::new());
    create_proof::<KZGCommitmentScheme<Bn256>, ProverSHPLONK<_>, _, _, _, _>(
        params,
        pk,
        &[circuit],
        &[&[&instances]],
        OsRng,
        &mut transcript,
    )
    .expect("create_proof");
    transcript.finalize()
}

pub fn verify(params: &ParamsKZG<Bn256>, vk: &VerifyingKey<G1Affine>, proof: &[u8], instances: &[Fr]) -> bool {
    let mut transcript = Keccak256Transcript::new(proof);
    verify_proof::<KZGCommitmentScheme<Bn256>, VerifierSHPLONK<_>, _, _, SingleStrategy<_>>(
        params,
        vk,
        SingleStrategy::new(params),
        &[&[instances]],
        &mut transcript,
    )
    .is_ok()
}

/// Single-contract verifier (VK embedded) for `NUM_INSTANCES` public inputs.
pub fn solidity_verifier(params: &ParamsKZG<Bn256>, vk: &VerifyingKey<G1Affine>) -> String {
    SolidityGenerator::new(params, vk, BatchOpenScheme::Bdfg21, NUM_INSTANCES)
        .render()
        .expect("render solidity")
}
