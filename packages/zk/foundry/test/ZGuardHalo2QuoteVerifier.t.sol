// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Halo2Verifier} from "zguard/Halo2QuoteVerifier.sol";
import {ZGuardHalo2QuoteVerifier} from "zguard/ZGuardHalo2QuoteVerifier.sol";

/// Minimal cheatcode interface (no forge-std dependency so the suite runs offline).
interface Vm {
    function readFile(string calldata) external view returns (string memory);
    function parseJsonString(string calldata, string calldata) external pure returns (string memory);
    function parseJsonBytes(string calldata, string calldata) external pure returns (bytes memory);
    function parseJsonUint(string calldata, string calldata) external pure returns (uint256);
    function parseJsonBool(string calldata, string calldata) external pure returns (bool);
    function expectRevert(bytes4) external;
    function toString(uint256) external pure returns (string memory);
}

/// Real Halo2-KZG proofs (fixtures/halo2-quote-proofs.json, produced by `zguard-halo2 prove-fixtures`)
/// verified by the generated Halo2Verifier through the ZGuard wrapper.
contract ZGuardHalo2QuoteVerifierTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant N = 7;

    ZGuardHalo2QuoteVerifier w;
    string json;

    struct Fx {
        bool covered;
        bytes quoteJson;
        bytes txJson;
        uint8 verdict;
        uint32 mask;
        bytes proof;
        bytes expected;
    }

    function setUp() public {
        w = new ZGuardHalo2QuoteVerifier(address(new Halo2Verifier()));
        json = vm.readFile("../fixtures/halo2-quote-proofs.json");
    }

    function _fx(uint256 i) internal view returns (Fx memory f) {
        string memory p = string.concat(".fixtures[", vm.toString(i), "]");
        f.covered = vm.parseJsonBool(json, string.concat(p, ".covered"));
        if (!f.covered) return f;
        f.quoteJson = bytes(vm.parseJsonString(json, string.concat(p, ".quoteJson")));
        f.txJson = bytes(vm.parseJsonString(json, string.concat(p, ".txJson")));
        f.verdict = uint8(vm.parseJsonUint(json, string.concat(p, ".verdict")));
        f.mask = uint32(vm.parseJsonUint(json, string.concat(p, ".mask")));
        f.proof = vm.parseJsonBytes(json, string.concat(p, ".proof"));
        f.expected = vm.parseJsonBytes(json, string.concat(p, ".expectedPublicValues"));
    }

    function test_all_covered_fixtures_verify_with_sp1_public_values() public view {
        uint256 covered;
        for (uint256 i = 0; i < N; i++) {
            Fx memory f = _fx(i);
            if (!f.covered) continue;
            bytes memory pv = w.verifyQuote(f.quoteJson, f.txJson, f.verdict, f.mask, f.proof);
            require(keccak256(pv) == keccak256(f.expected), "public values != SP1/quote-rules");
            covered++;
        }
        require(covered == 5, "expected 5 covered fixtures");
    }

    function test_rejects_wrong_verdict() public {
        Fx memory f = _fx(1); // deny-q001-recipient
        require(f.verdict == 2, "fixture order");
        vm.expectRevert(ZGuardHalo2QuoteVerifier.InvalidProof.selector);
        w.verifyQuote(f.quoteJson, f.txJson, 1, 0, f.proof);
    }

    function test_rejects_wrong_mask() public {
        Fx memory f = _fx(1);
        vm.expectRevert(ZGuardHalo2QuoteVerifier.InvalidProof.selector);
        w.verifyQuote(f.quoteJson, f.txJson, f.verdict, f.mask | 4, f.proof);
    }

    function test_rejects_tampered_json() public {
        Fx memory f = _fx(0); // allow
        bytes memory q = f.quoteJson;
        q[q.length - 4] = q[q.length - 4] == bytes1("0") ? bytes1("1") : bytes1("0"); // last payTo nibble
        vm.expectRevert(ZGuardHalo2QuoteVerifier.InvalidProof.selector);
        w.verifyQuote(q, f.txJson, f.verdict, f.mask, f.proof);
    }

    function test_rejects_proof_from_other_fixture() public {
        Fx memory allow = _fx(0);
        Fx memory deny = _fx(2); // deny-q002-amount
        vm.expectRevert(ZGuardHalo2QuoteVerifier.InvalidProof.selector);
        w.verifyQuote(deny.quoteJson, deny.txJson, deny.verdict, deny.mask, allow.proof);
    }

    function test_rejects_trailing_nul_and_oversize() public {
        Fx memory f = _fx(0);
        vm.expectRevert(ZGuardHalo2QuoteVerifier.BadJsonLength.selector);
        w.verifyQuote(bytes.concat(f.quoteJson, hex"00"), f.txJson, f.verdict, f.mask, f.proof);
        vm.expectRevert(ZGuardHalo2QuoteVerifier.BadJsonLength.selector);
        w.verifyQuote(f.quoteJson, new bytes(496), f.verdict, f.mask, f.proof);
    }

    function test_record_once() public {
        Fx memory f = _fx(6); // abstain-q007-domain-unverified
        require(f.verdict == 3 && f.mask == 64, "fixture order");
        bytes32 id = keccak256("dec_halo2_1");
        bytes memory pv = w.verifyAndRecord(id, f.quoteJson, f.txJson, f.verdict, f.mask, f.proof);
        require(w.verifiedDecisionIds(id), "not recorded");
        require(w.decisionPublicValuesHash(id) == keccak256(pv), "pv hash");
        vm.expectRevert(ZGuardHalo2QuoteVerifier.AlreadyVerified.selector);
        w.verifyAndRecord(id, f.quoteJson, f.txJson, f.verdict, f.mask, f.proof);
    }
}
