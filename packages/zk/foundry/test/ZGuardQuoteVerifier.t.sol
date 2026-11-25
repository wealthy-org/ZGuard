// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ZGuardQuoteVerifier, ISP1VerifierGateway} from "zguard/ZGuardQuoteVerifier.sol";

/// Minimal cheatcode interface (no forge-std dependency so the suite runs offline).
interface Vm {
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function expectRevert() external;
    function prank(address) external;
    function warp(uint256) external;
}

/// Behaves like the real SP1 verifier gateway for an invalid proof: always reverts.
contract RejectingGateway is ISP1VerifierGateway {
    error InvalidProof();

    function verifyProof(bytes32, bytes calldata, bytes calldata) external pure {
        revert InvalidProof();
    }
}

/// Accepts exactly one (vkey, publicValues, proof) triple — stands in for a valid Groth16 proof.
contract SingleProofGateway is ISP1VerifierGateway {
    bytes32 public immutable vkey;
    bytes32 public immutable pvHash;
    bytes32 public immutable proofHash;

    constructor(bytes32 _vkey, bytes memory _pv, bytes memory _proof) {
        vkey = _vkey;
        pvHash = keccak256(_pv);
        proofHash = keccak256(_proof);
    }

    function verifyProof(bytes32 k, bytes calldata pv, bytes calldata proof) external view {
        require(k == vkey && keccak256(pv) == pvHash && keccak256(proof) == proofHash, "invalid proof");
    }
}

contract ZGuardQuoteVerifierTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 constant VKEY = keccak256("real-program-vkey");
    bytes32 constant DECISION = keccak256("dec_1");

    // BN254 G2 generator (EIP-197 ordering) — same constants the removed Path B used.
    uint256 constant G2_X_IM = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant G2_X_RE = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant G2_Y_IM = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant G2_Y_RE = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583;
    uint256 constant R = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function _pv(bytes32 scope, uint8 verdict) internal pure returns (bytes memory) {
        return abi.encode(scope, keccak256("quote-commit"), keccak256("tx-commit"), verdict, uint32(0));
    }

    function _assert(bool ok, string memory why) internal pure {
        require(ok, why);
    }

    /// C1: the old tautological Path-B call (A = s·G1, e(A,G2)·e(-A,G2) == 1) must no longer verify anything.
    function test_C1_pathB_tautology_envelope_is_rejected() public {
        RejectingGateway gw = new RejectingGateway();
        ZGuardQuoteVerifier v = new ZGuardQuoteVerifier(address(gw), VKEY);
        bytes memory pv = _pv(keccak256("quote"), 1);

        // Build exactly the envelope the removed TypeScript Path B produced.
        uint256 s = (uint256(keccak256(pv)) % (R - 1)) + 1;
        uint256[3] memory mulIn = [uint256(1), uint256(2), s];
        uint256[2] memory a;
        bool ok;
        assembly {
            ok := staticcall(gas(), 7, mulIn, 96, a, 64)
        }
        _assert(ok, "ecMul failed");
        bytes memory envelope = abi.encode(
            VKEY,
            [a[0], a[1]],
            [[G2_X_IM, G2_X_RE], [G2_Y_IM, G2_Y_RE]],
            [a[0], (Q - a[1]) % Q],
            keccak256(pv)
        );

        // (a) the old selector no longer exists -> call fails
        (bool okOld, ) = address(v).call(
            abi.encodeWithSignature(
                "verifyAndRecordCommitmentProof(bytes32,bytes,bytes,string)", DECISION, pv, envelope, "groth16-sp1"
            )
        );
        _assert(!okOld, "verifyAndRecordCommitmentProof must not exist");

        // (b) the same envelope submitted as an SP1 proof is rejected by the gateway
        vm.expectRevert(RejectingGateway.InvalidProof.selector);
        v.verifySp1QuoteProof(DECISION, pv, envelope);
        _assert(!v.verifiedDecisionIds(DECISION), "decision must stay unverified");
    }

    /// C1: random fake proof bytes + fake publicValues revert.
    function test_C1_fake_proof_reverts() public {
        ZGuardQuoteVerifier v = new ZGuardQuoteVerifier(address(new RejectingGateway()), VKEY);
        vm.expectRevert(RejectingGateway.InvalidProof.selector);
        v.verifySp1QuoteProof(DECISION, _pv(keccak256("quote"), 1), hex"deadbeef");
        _assert(!v.verifiedDecisionIds(DECISION), "must not record");
    }

    /// With a gateway that accepts only one proof: tampering with publicValues (verdict flip) reverts.
    function test_C1_tampered_public_values_revert() public {
        bytes memory pv = _pv(keccak256("quote"), 2); // deny
        bytes memory proof = hex"c0ffee";
        ZGuardQuoteVerifier v = new ZGuardQuoteVerifier(address(new SingleProofGateway(VKEY, pv, proof)), VKEY);

        vm.expectRevert(bytes("invalid proof"));
        v.verifySp1QuoteProof(DECISION, _pv(keccak256("quote"), 1), proof); // claims allow

        _assert(v.verifySp1QuoteProof(DECISION, pv, proof), "genuine proof must verify");
        _assert(v.verifiedDecisionIds(DECISION), "recorded");
        _assert(v.decisionPublicValuesHash(DECISION) == keccak256(pv), "bound to publicValues");

        // replay / overwrite of the same decisionId is refused
        vm.expectRevert(ZGuardQuoteVerifier.AlreadyVerified.selector);
        v.verifySp1QuoteProof(DECISION, pv, proof);
    }

    function test_scope_must_be_quote() public {
        bytes memory pv = _pv(keccak256("simulation"), 1);
        bytes memory proof = hex"01";
        ZGuardQuoteVerifier v = new ZGuardQuoteVerifier(address(new SingleProofGateway(VKEY, pv, proof)), VKEY);
        vm.expectRevert(ZGuardQuoteVerifier.ScopeMustBeQuote.selector);
        v.verifySp1QuoteProof(DECISION, pv, proof);
    }

    function test_unconfigured_gateway_or_vkey_reverts() public {
        ZGuardQuoteVerifier v = new ZGuardQuoteVerifier(address(0), VKEY);
        vm.expectRevert(ZGuardQuoteVerifier.NotConfigured.selector);
        v.verifySp1QuoteProof(DECISION, _pv(keccak256("quote"), 1), hex"01");

        ZGuardQuoteVerifier v2 = new ZGuardQuoteVerifier(address(new RejectingGateway()), bytes32(0));
        vm.expectRevert(ZGuardQuoteVerifier.NotConfigured.selector);
        v2.checkSp1QuoteProof(_pv(keccak256("quote"), 1), hex"01");
    }

    /// B3: config changes are owner-only and timelocked; ownership transfer is two-step.
    function test_B3_governance() public {
        ZGuardQuoteVerifier v = new ZGuardQuoteVerifier(address(new RejectingGateway()), VKEY);
        address attacker = address(0xBEEF);

        vm.prank(attacker);
        vm.expectRevert(ZGuardQuoteVerifier.Unauthorized.selector);
        v.proposeGatewayAndVKey(attacker, bytes32(uint256(1)));

        v.proposeGatewayAndVKey(address(0x1234), bytes32(uint256(2)));
        vm.expectRevert();
        v.applyGatewayAndVKey(); // TimelockActive
        vm.warp(block.timestamp + v.CONFIG_DELAY());
        v.applyGatewayAndVKey();
        _assert(v.sp1Gateway() == address(0x1234), "gateway applied after delay");

        address multisig = address(0x5AFE);
        v.transferOwnership(multisig);
        _assert(v.owner() == address(this), "owner unchanged until accepted");
        vm.prank(attacker);
        vm.expectRevert(ZGuardQuoteVerifier.Unauthorized.selector);
        v.acceptOwnership();
        vm.prank(multisig);
        v.acceptOwnership();
        _assert(v.owner() == multisig, "two-step ownership");
    }

    /// B3: the owner can no longer record batch roots without a proof.
    function test_B3_no_owner_trusted_batch_root() public {
        ZGuardQuoteVerifier v = new ZGuardQuoteVerifier(address(new RejectingGateway()), VKEY);
        (bool ok, ) = address(v).call(
            abi.encodeWithSignature("recordVerifiedBatchRoot(bytes32,uint256,string)", bytes32(uint256(1)), 1, "x")
        );
        _assert(!ok, "recordVerifiedBatchRoot must not exist");
    }
}
