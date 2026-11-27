#!/usr/bin/env bash
# Downloads the pinned KZG SRS (BN254, k=13) used by the Halo2 quote circuit and checks its SHA-256.
# Source: Axiom's setup derived from the Perpetual Powers of Tau ceremony, challenge 0085.
set -euo pipefail
URL="https://axiom-crypto.s3.amazonaws.com/challenge_0085/kzg_bn254_13.srs"
SHA256="ff7e044c842f4a2b1bb889618e5b4e8e15268f8c589b5c37f628f528b4969a02"
OUT="${1:-$(dirname "$0")/../halo2-quote-circuit/srs/kzg_bn254_13.srs}"
mkdir -p "$(dirname "$OUT")"
if [ ! -f "$OUT" ] || ! echo "$SHA256  $OUT" | sha256sum -c --status; then
  curl -fsSL --retry 3 -o "$OUT.tmp" "$URL"
  mv "$OUT.tmp" "$OUT"
fi
echo "$SHA256  $OUT" | sha256sum -c
