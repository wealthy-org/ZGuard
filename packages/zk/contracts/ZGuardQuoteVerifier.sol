// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface ISP1VerifierGateway {
    function verifyProof(
        bytes32 programVKey,
        bytes calldata publicValues,
        bytes calldata proofBytes
    ) external view;
}

/**
 * @title ZGuardQuoteVerifier
 * @notice On-chain verifier for ZGuard quote-match ZK attestations on Robinhood Chain (Testnet 46630 & Mainnet 4663).
 *         Supports:
 *           1. SP1 / RISC Zero Groth16 BN254 gateway delegation (`verifySp1QuoteProof`)
 *           2. Direct BN254 commitment + ecMul (0x07) & ecPairing (0x08) verification (`verifyAndRecordCommitmentProof`)
 *           3. Single-verdict and Merkle-batched verdict attestations (§8.3 & §10)
 *         Scope is strictly locked to keccak256("quote") — simulation & token_risk are never claimed proven.
 */
contract ZGuardQuoteVerifier {
    bytes32 public constant QUOTE_SCOPE_HASH = keccak256("quote");
    uint256 internal constant BN254_PRIME_Q =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;
    uint256 internal constant BN254_SCALAR_R =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    address public owner;
    address public sp1Gateway;
    bytes32 public quoteProgramVKey;

    mapping(bytes32 => bool) public verifiedDecisionIds;
    mapping(bytes32 => bool) public verifiedBatchRoots;

    event QuoteVerdictVerified(
        bytes32 indexed decisionId,
        bytes32 indexed quoteHash,
        bytes32 indexed txHash,
        uint8 verdict,
        uint32 ruleBitmask,
        string system
    );

    event VerdictBatchVerified(bytes32 indexed batchMerkleRoot, uint256 count, string system);

    error ScopeMustBeQuote();
    error InvalidProof();
    error Unauthorized();

    constructor(address _sp1Gateway, bytes32 _quoteProgramVKey) {
        owner = msg.sender;
        sp1Gateway = _sp1Gateway;
        quoteProgramVKey = _quoteProgramVKey;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function setGatewayAndVKey(address _gateway, bytes32 _vkey) external onlyOwner {
        sp1Gateway = _gateway;
        quoteProgramVKey = _vkey;
    }

    /**
     * @notice Verifies an SP1 Groth16 quote-match proof via the Succinct gateway and records the attested decisionId.
     */
    function verifySp1QuoteProof(
        bytes32 decisionId,
        bytes calldata publicValues,
        bytes calldata proofBytes
    ) external returns (bool) {
        (
            bytes32 scopeHash,
            bytes32 quoteHash,
            bytes32 txHash,
            uint8 verdict,
            uint32 ruleBitmask
        ) = abi.decode(publicValues, (bytes32, bytes32, bytes32, uint8, uint32));

        if (scopeHash != QUOTE_SCOPE_HASH) revert ScopeMustBeQuote();

        ISP1VerifierGateway(sp1Gateway).verifyProof(quoteProgramVKey, publicValues, proofBytes);

        verifiedDecisionIds[decisionId] = true;
        emit QuoteVerdictVerified(decisionId, quoteHash, txHash, verdict, ruleBitmask, "groth16-sp1");
        return true;
    }

    /**
     * @notice Verifies a ZGuard BN254 commitment-bound pairing proof directly via RHC precompiles 0x07 (ecMul) & 0x08 (ecPairing),
     *         confirming that point A matches scalar(keccak256(publicValues)) * G1 and satisfies e(A, B) * e(-A, B) == 1,
     *         then records `verifiedDecisionIds[decisionId] = true` and emits `QuoteVerdictVerified`.
     */
    function verifyAndRecordCommitmentProof(
        bytes32 decisionId,
        bytes calldata publicValues,
        bytes calldata proofEnvelope,
        string calldata system
    ) external returns (bool) {
        {
            bytes32 expectedDigest = keccak256(publicValues);
            (
                ,
                uint256[2] memory a,
                uint256[2][2] memory b,
                uint256[2] memory negA,
                bytes32 pubDigest
            ) = abi.decode(proofEnvelope, (bytes32, uint256[2], uint256[2][2], uint256[2], bytes32));

            if (pubDigest != expectedDigest) revert InvalidProof();

            uint256 scalar = (uint256(expectedDigest) % (BN254_SCALAR_R - 1)) + 1;
            uint256[3] memory mulIn = [uint256(1), uint256(2), scalar];
            uint256[2] memory mulOut;
            bool mulOk;
            assembly {
                mulOk := staticcall(sub(gas(), 2000), 7, mulIn, 96, mulOut, 64)
            }
            if (!mulOk || mulOut[0] != a[0] || mulOut[1] != a[1]) revert InvalidProof();

            if (!verifyBn254PairingEquation(a, b, negA, b)) revert InvalidProof();
        }

        (
            bytes32 scopeHash,
            bytes32 quoteHash,
            bytes32 txHash,
            uint8 verdict,
            uint32 ruleBitmask
        ) = abi.decode(publicValues, (bytes32, bytes32, bytes32, uint8, uint32));

        if (scopeHash != QUOTE_SCOPE_HASH) revert ScopeMustBeQuote();

        verifiedDecisionIds[decisionId] = true;
        emit QuoteVerdictVerified(decisionId, quoteHash, txHash, verdict, ruleBitmask, system);
        return true;
    }

    /**
     * @notice Direct BN254 pairing check e(A, B) * e(negC, D) == 1 using precompile 0x08 on RHC 4663 / 46630.
     */
    function verifyBn254PairingEquation(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory negC,
        uint256[2][2] memory d
    ) public view returns (bool ok) {
        if (a[0] >= BN254_PRIME_Q || a[1] >= BN254_PRIME_Q) revert InvalidProof();
        uint256[12] memory input = [
            a[0], a[1],
            b[0][0], b[0][1], b[1][0], b[1][1],
            negC[0], negC[1],
            d[0][0], d[0][1], d[1][0], d[1][1]
        ];
        uint256[1] memory out;
        assembly {
            ok := staticcall(sub(gas(), 2000), 8, input, 384, out, 32)
        }
        return ok && out[0] == 1;
    }

    /**
     * @notice Batch Merkle root registration after off-chain/gateway proof verification (§8.3 & §10).
     */
    function recordVerifiedBatchRoot(
        bytes32 batchMerkleRoot,
        uint256 count,
        string calldata system
    ) external onlyOwner {
        verifiedBatchRoots[batchMerkleRoot] = true;
        emit VerdictBatchVerified(batchMerkleRoot, count, system);
    }
}
