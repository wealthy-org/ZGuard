// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title ZGuardHalo2QuoteVerifier
 * @notice Second proof system for ZGuard quote-match (brief §8.3 path 2, gap H7): a PSE Halo2-KZG proof
 *         (BN254, SHPLONK, Keccak transcript) of `zguard-quote-rules::evaluate` on the eip3009 rail.
 *
 *         The caller passes the canonical quote / tx JSON (the exact bytes the SDK hashes in
 *         `computeQuoteAndTxCommitments`). This contract hashes them with KECCAK256 and packs the same bytes
 *         into the circuit's public inputs, so a valid proof binds `quoteHash` / `txHash` exactly like the SP1
 *         path, and `verifyQuote` returns the same 160-byte public values:
 *             abi.encode(keccak256("quote"), keccak256(quoteJson), keccak256(txJson), uint8 verdict, uint32 mask)
 *
 *         Proven from the bytes: Q-001 (recipient) and Q-002 (amount). Q-003/Q-004/Q-006 and the Q-007 domain
 *         check are private prover hints, exactly as in the SP1 guest. Q-005 / Q-DECODE / non-eip3009 inputs
 *         have no Halo2 proof (SP1 only). The SRS is the Perpetual-Powers-of-Tau-derived Axiom setup
 *         (challenge 0085); the generated `Halo2Verifier` is from the unaudited PSE halo2-solidity-verifier.
 *
 *         No owner, no upgrade: a new circuit means a new `Halo2Verifier` and a new wrapper.
 */
contract ZGuardHalo2QuoteVerifier {
    bytes32 public constant QUOTE_SCOPE_HASH = keccak256("quote");
    uint256 public constant CHUNK = 31;
    uint256 public constant MAX_QUOTE_BYTES = 279; // 9 chunks; JSON must be strictly shorter
    uint256 public constant MAX_TX_BYTES = 496; // 16 chunks
    uint256 public constant NUM_INSTANCES = 9 + 16 + 2;

    /// @notice Generated `Halo2Verifier` (`verifyProof(bytes,uint256[])`, VK embedded).
    address public immutable halo2Verifier;

    mapping(bytes32 => bool) public verifiedDecisionIds;
    mapping(bytes32 => bytes32) public decisionPublicValuesHash;

    event QuoteVerdictVerified(
        bytes32 indexed decisionId,
        bytes32 indexed quoteHash,
        bytes32 indexed txHash,
        uint8 verdict,
        uint32 ruleBitmask,
        string system
    );

    error BadJsonLength();
    error InvalidProof();
    error AlreadyVerified();

    constructor(address _halo2Verifier) {
        halo2Verifier = _halo2Verifier;
    }

    /// @notice Public inputs in circuit order: 9 quote chunks, 16 tx chunks (big-endian, NUL padded), verdict, mask.
    function instancesOf(bytes calldata quoteJson, bytes calldata txJson, uint8 verdict, uint32 ruleBitmask)
        public
        pure
        returns (uint256[] memory inst)
    {
        // NUL is the padding byte; JSON never contains it. Rejecting a trailing NUL makes the packing injective
        // (an embedded NUL would force every later byte to be NUL in the circuit, so the last byte would be 0).
        if (
            quoteJson.length == 0 || quoteJson.length >= MAX_QUOTE_BYTES || quoteJson[quoteJson.length - 1] == 0
                || txJson.length == 0 || txJson.length >= MAX_TX_BYTES || txJson[txJson.length - 1] == 0
        ) revert BadJsonLength();
        inst = new uint256[](NUM_INSTANCES);
        _pack(quoteJson, inst, 0, MAX_QUOTE_BYTES / CHUNK);
        _pack(txJson, inst, MAX_QUOTE_BYTES / CHUNK, MAX_TX_BYTES / CHUNK);
        inst[NUM_INSTANCES - 2] = verdict;
        inst[NUM_INSTANCES - 1] = ruleBitmask;
    }

    function _pack(bytes calldata data, uint256[] memory inst, uint256 at, uint256 chunks) private pure {
        uint256 len = data.length;
        for (uint256 c = 0; c < chunks; c++) {
            uint256 start = c * CHUNK;
            uint256 acc = 0;
            if (start < len) {
                uint256 word;
                assembly ("memory-safe") {
                    word := calldataload(add(data.offset, start))
                }
                acc = word >> 8; // first 31 bytes, big-endian
                uint256 avail = len - start;
                if (avail < CHUNK) {
                    uint256 drop = 8 * (CHUNK - avail); // bytes past the end read neighbouring calldata
                    acc = (acc >> drop) << drop;
                }
            }
            inst[at + c] = acc;
        }
    }

    /**
     * @notice Verifies the proof and returns the SP1-compatible public values. Reverts when invalid.
     *         Used by the API via eth_call (no gas, no state).
     */
    function verifyQuote(
        bytes calldata quoteJson,
        bytes calldata txJson,
        uint8 verdict,
        uint32 ruleBitmask,
        bytes calldata proof
    ) public view returns (bytes memory publicValues) {
        uint256[] memory inst = instancesOf(quoteJson, txJson, verdict, ruleBitmask);
        (bool ok, bytes memory ret) =
            halo2Verifier.staticcall(abi.encodeWithSignature("verifyProof(bytes,uint256[])", proof, inst));
        if (!ok || ret.length != 32 || abi.decode(ret, (uint256)) != 1) revert InvalidProof();
        publicValues = abi.encode(QUOTE_SCOPE_HASH, keccak256(quoteJson), keccak256(txJson), verdict, ruleBitmask);
    }

    /// @notice Verifies and records `decisionId` (first proof wins, no overwrite), like the SP1 verifier.
    function verifyAndRecord(
        bytes32 decisionId,
        bytes calldata quoteJson,
        bytes calldata txJson,
        uint8 verdict,
        uint32 ruleBitmask,
        bytes calldata proof
    ) external returns (bytes memory publicValues) {
        if (verifiedDecisionIds[decisionId]) revert AlreadyVerified();
        publicValues = verifyQuote(quoteJson, txJson, verdict, ruleBitmask, proof);
        verifiedDecisionIds[decisionId] = true;
        decisionPublicValuesHash[decisionId] = keccak256(publicValues);
        emit QuoteVerdictVerified(
            decisionId, keccak256(quoteJson), keccak256(txJson), verdict, ruleBitmask, "halo2-kzg-shplonk"
        );
    }
}
