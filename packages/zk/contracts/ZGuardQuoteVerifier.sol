// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface ISP1VerifierGateway {
    /// @dev Reverts when the proof is invalid for (programVKey, publicValues).
    function verifyProof(
        bytes32 programVKey,
        bytes calldata publicValues,
        bytes calldata proofBytes
    ) external view;
}

/**
 * @title ZGuardQuoteVerifier
 * @notice On-chain verifier for ZGuard quote-match attestations on Robinhood Chain Testnet 46630.
 *
 *         The ONLY way a decision becomes "verified" is a real SP1 Groth16 proof accepted by the Succinct
 *         SP1 verifier gateway (`verifySp1QuoteProof`). There is deliberately no fallback path:
 *         the previous `verifyAndRecordCommitmentProof` accepted `e(A,B)·e(-A,B) == 1`, which holds for
 *         ANY point A and therefore proved nothing (gap C1). It has been removed.
 *
 *         Scope is strictly locked to keccak256("quote") — simulation & token_risk are never claimed proven.
 *
 *         Governance (gap B3):
 *           - two-step ownership transfer (the owner SHOULD be a multisig, never a hot EOA);
 *           - gateway / program vkey changes are timelocked (CONFIG_DELAY) and announced by events;
 *           - no owner-only "trust me" recording: batch roots are not supported until the guest program
 *             proves batches (removed `recordVerifiedBatchRoot`).
 */
contract ZGuardQuoteVerifier {
    bytes32 public constant QUOTE_SCOPE_HASH = keccak256("quote");
    uint256 public constant CONFIG_DELAY = 2 days;

    address public owner;
    address public pendingOwner;
    address public sp1Gateway;
    bytes32 public quoteProgramVKey;

    struct PendingConfig {
        address gateway;
        bytes32 vkey;
        uint64 eta;
    }

    PendingConfig public pendingConfig;

    mapping(bytes32 => bool) public verifiedDecisionIds;
    /// @notice keccak256(publicValues) bound to each verified decisionId (first proof wins, no overwrite).
    mapping(bytes32 => bytes32) public decisionPublicValuesHash;

    event QuoteVerdictVerified(
        bytes32 indexed decisionId,
        bytes32 indexed quoteHash,
        bytes32 indexed txHash,
        uint8 verdict,
        uint32 ruleBitmask,
        string system
    );
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ConfigProposed(address gateway, bytes32 vkey, uint64 eta);
    event ConfigApplied(address gateway, bytes32 vkey);
    event ConfigCancelled();

    error ScopeMustBeQuote();
    error Unauthorized();
    error NotConfigured();
    error AlreadyVerified();
    error TimelockActive(uint64 eta);
    error NoPendingConfig();

    constructor(address _sp1Gateway, bytes32 _quoteProgramVKey) {
        owner = msg.sender;
        sp1Gateway = _sp1Gateway;
        quoteProgramVKey = _quoteProgramVKey;
        emit OwnershipTransferred(address(0), msg.sender);
        emit ConfigApplied(_sp1Gateway, _quoteProgramVKey);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    // ------------------------------------------------------------------ ownership (two-step)

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ------------------------------------------------------------------ timelocked configuration

    function proposeGatewayAndVKey(address _gateway, bytes32 _vkey) external onlyOwner {
        uint64 eta = uint64(block.timestamp + CONFIG_DELAY);
        pendingConfig = PendingConfig({gateway: _gateway, vkey: _vkey, eta: eta});
        emit ConfigProposed(_gateway, _vkey, eta);
    }

    function applyGatewayAndVKey() external onlyOwner {
        PendingConfig memory p = pendingConfig;
        if (p.eta == 0) revert NoPendingConfig();
        if (block.timestamp < p.eta) revert TimelockActive(p.eta);
        sp1Gateway = p.gateway;
        quoteProgramVKey = p.vkey;
        delete pendingConfig;
        emit ConfigApplied(p.gateway, p.vkey);
    }

    function cancelGatewayAndVKey() external onlyOwner {
        delete pendingConfig;
        emit ConfigCancelled();
    }

    // ------------------------------------------------------------------ verification

    /**
     * @notice Verifies an SP1 Groth16 quote-match proof via the SP1 verifier gateway and records the decisionId.
     * @dev publicValues = abi.encode(bytes32 scopeHash, bytes32 quoteHash, bytes32 txHash, uint8 verdict, uint32 ruleBitmask)
     *      — exactly what the SP1 guest commits. Reverts on an invalid proof (gateway reverts) or missing config.
     */
    function verifySp1QuoteProof(
        bytes32 decisionId,
        bytes calldata publicValues,
        bytes calldata proofBytes
    ) external returns (bool) {
        if (sp1Gateway == address(0) || quoteProgramVKey == bytes32(0)) revert NotConfigured();
        if (verifiedDecisionIds[decisionId]) revert AlreadyVerified();

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
        decisionPublicValuesHash[decisionId] = keccak256(publicValues);
        emit QuoteVerdictVerified(decisionId, quoteHash, txHash, verdict, ruleBitmask, "groth16-sp1");
        return true;
    }

    /**
     * @notice Read-only check: does the gateway accept this proof? Reverts on invalid proof / missing config.
     *         Used by the API (eth_call) to move an attestation to "proven" without spending gas.
     */
    function checkSp1QuoteProof(bytes calldata publicValues, bytes calldata proofBytes) external view returns (bool) {
        if (sp1Gateway == address(0) || quoteProgramVKey == bytes32(0)) revert NotConfigured();
        (bytes32 scopeHash, , , , ) = abi.decode(publicValues, (bytes32, bytes32, bytes32, uint8, uint32));
        if (scopeHash != QUOTE_SCOPE_HASH) revert ScopeMustBeQuote();
        ISP1VerifierGateway(sp1Gateway).verifyProof(quoteProgramVKey, publicValues, proofBytes);
        return true;
    }
}
