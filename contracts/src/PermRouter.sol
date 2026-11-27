// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IPermAdapter} from "./interfaces/IPermAdapter.sol";
import {IPermit2} from "./interfaces/IPermit2.sol";

/// @title PermRouter v2
/// @notice Signed exact-input settlement with versioned fee rebates and multi-adapter routes.
/// @dev Quotes use EIP-712 and bind account, route, fee policy, recipient, chain and timing.
///      Venue fees are paid through pull accounting so a fee recipient cannot block a swap.
contract PermRouter is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_PLATFORM_FEE_BPS = 100; // hard cap: 1%
    uint256 public constant MAX_QUOTE_AGE = 120 seconds;
    uint256 public constant MAX_ROUTE_STEPS = 4;
    uint256 public constant MAX_QUOTED_GAS = 30_000_000;
    uint32 public constant INITIAL_POLICY_VERSION = 1;
    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "PermQuote(address account,address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,uint256 gasEstimate,address recipient,uint256 deadline,uint64 quotedAt,uint32 policyVersion,uint256 chainId,address referrer,bytes32 routeHash)"
    );

    struct FeePolicy {
        uint16 platformFeeBps;
        uint16 rebateShareBps;
        bool enabled;
        bool exists;
    }

    struct AdapterConfig {
        bool enabled;
        bytes32 providerId;
    }

    struct RouteStep {
        address adapter;
        address tokenIn;
        address tokenOut;
        bytes data;
    }

    struct SwapRequest {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 gasEstimate;
        address recipient;
        uint256 deadline;
        uint64 quotedAt;
        uint32 policyVersion;
        uint256 chainId;
        bytes32 quoteId;
        address referrer;
        bytes routeData;
    }

    struct PermitInput {
        uint256 nonce;
        uint256 deadline;
        bytes signature;
    }

    struct SettlementAmounts {
        uint256 grossFee;
        uint256 rebate;
        uint256 netFee;
        uint256 referralFee;
        uint256 treasuryFee;
        uint256 routedInput;
        uint256 amountOut;
    }

    mapping(uint32 version => FeePolicy) public feePolicies;
    mapping(address adapter => AdapterConfig) public adapters;
    mapping(address adapter => bytes32 codehash) public adapterCodehashes;
    mapping(address adapter => bytes32 providerId) public hookProviderIds;
    mapping(address referrer => uint16 shareBpsOfNetFee) public referralShares;
    mapping(bytes32 quoteId => bool) public consumedQuotes;
    mapping(address token => mapping(address beneficiary => uint256 amount)) public claimableFees;
    mapping(address token => uint256 amount) public totalClaimableFees;

    address public treasury;
    address public quoteSigner;
    address public pauseGuardian;
    IPermit2 public immutable permit2;
    uint32 public activePolicyVersion;
    uint256 public settlementNonce;

    event FeePolicyPublished(uint32 indexed version, uint16 platformFeeBps, uint16 rebateShareBps, bool enabled);
    event ActiveFeePolicyChanged(uint32 indexed previousVersion, uint32 indexed newVersion);
    event FeePolicyStatusChanged(uint32 indexed version, bool enabled);
    event AdapterConfigured(address indexed adapter, bytes32 indexed providerId, bool enabled, bytes32 codehash);
    event HookProviderConfigured(address indexed adapter, bytes32 indexed providerId);
    event ReferralConfigured(address indexed referrer, uint16 shareBpsOfNetFee);
    event TreasuryChanged(address indexed previousTreasury, address indexed newTreasury);
    event QuoteSignerChanged(address indexed previousSigner, address indexed newSigner);
    event PauseGuardianChanged(address indexed previousGuardian, address indexed newGuardian);
    event FeeAccrued(address indexed token, address indexed beneficiary, uint256 amount);
    event FeeClaimed(address indexed token, address indexed beneficiary, address indexed recipient, uint256 amount);
    event ExcessRescued(address indexed token, address indexed recipient, uint256 amount);
    event RouteStepSettled(
        bytes32 indexed receiptId,
        uint8 indexed stepIndex,
        bytes32 indexed providerId,
        address adapter,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bytes32 stepRouteId,
        address hook,
        bytes32 hookCodehash
    );
    event SwapSettled(
        bytes32 indexed receiptId,
        bytes32 indexed quoteId,
        address indexed account,
        address recipient,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 routedInput,
        uint256 amountOut,
        uint256 grossFee,
        uint256 rebate,
        uint256 netFee,
        uint256 referralFee,
        uint256 treasuryFee,
        uint32 policyVersion,
        bytes32 routeId,
        bytes32 routeHash
    );

    error AdapterDisabled(address adapter);
    error AdapterCodehashMismatch(address adapter, bytes32 expected, bytes32 actual);
    error AdapterOutputMismatch(uint256 reported, uint256 actual);
    error AlreadyConsumed(bytes32 quoteId);
    error AmountTooLarge();
    error ChainMismatch(uint256 expected, uint256 actual);
    error DeadlineExpired();
    error FeeOnTransferInputUnsupported();
    error InsufficientExcess(uint256 available, uint256 requested);
    error InvalidAddress();
    error InvalidAmount();
    error InvalidFeePolicy();
    error InvalidNativeValue();
    error InvalidPair();
    error InvalidPermit();
    error InvalidQuoteSigner(address recovered, address expected);
    error InvalidRoute();
    error OutputBelowMinimum(uint256 actual, uint256 minimum);
    error PolicyUnavailable(uint32 version);
    error QuoteBindingMismatch(bytes32 supplied, bytes32 expected);
    error QuoteFromFuture();
    error QuoteStale();
    error SelfReferral();
    error TransferFailed();
    error UnauthorizedPauseGuardian(address account);

    constructor(address initialOwner, address initialTreasury, address initialQuoteSigner, IPermit2 permit2_)
        Ownable(initialOwner)
        EIP712("Perm", "2")
    {
        if (
            initialOwner == address(0) || initialTreasury == address(0) || initialQuoteSigner == address(0)
                || address(permit2_) == address(0)
        ) {
            revert InvalidAddress();
        }
        treasury = initialTreasury;
        quoteSigner = initialQuoteSigner;
        pauseGuardian = initialOwner;
        permit2 = permit2_;
        _publishFeePolicy(INITIAL_POLICY_VERSION, 20, 2_500, true);
        activePolicyVersion = INITIAL_POLICY_VERSION;
    }

    receive() external payable {}

    function routeHash(bytes calldata routeData) public pure returns (bytes32) {
        return keccak256(routeData);
    }

    function quoteIdFor(address account, SwapRequest calldata request) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                QUOTE_TYPEHASH,
                account,
                request.tokenIn,
                request.tokenOut,
                request.amountIn,
                request.minAmountOut,
                request.gasEstimate,
                request.recipient,
                request.deadline,
                request.quotedAt,
                request.policyVersion,
                request.chainId,
                request.referrer,
                keccak256(request.routeData)
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function decodeRoute(bytes calldata routeData) external pure returns (RouteStep[] memory) {
        return abi.decode(routeData, (RouteStep[]));
    }

    function previewFees(uint256 amountIn, uint32 policyVersion)
        public
        view
        returns (uint256 grossFee, uint256 rebate, uint256 netFee, uint256 routedInput)
    {
        FeePolicy memory policy = feePolicies[policyVersion];
        if (!policy.exists || !policy.enabled) revert PolicyUnavailable(policyVersion);
        // Integer floor rounding is the published settlement policy and is reproduced by the API.
        // slither-disable-next-line divide-before-multiply
        grossFee = amountIn * policy.platformFeeBps / BPS;
        // slither-disable-next-line divide-before-multiply
        rebate = grossFee * policy.rebateShareBps / BPS;
        netFee = grossFee - rebate;
        routedInput = amountIn - netFee;
    }

    // The bounded four-step execution path is intentionally explicit for settlement evidence.
    // slither-disable-next-line cyclomatic-complexity
    function swapExactInput(SwapRequest calldata request, bytes calldata quoteSignature, PermitInput calldata permitInput)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (bytes32 receiptId, SettlementAmounts memory settled)
    {
        _validateRequest(request, quoteSignature);
        RouteStep[] memory steps = abi.decode(request.routeData, (RouteStep[]));
        _validateRoute(request, steps);

        // Effects are committed before Permit2, token, adapter, and recipient calls. Any
        // downstream revert atomically rolls them back; nonReentrant blocks callbacks.
        consumedQuotes[request.quoteId] = true;
        (settled.grossFee, settled.rebate, settled.netFee, settled.routedInput) =
            previewFees(request.amountIn, request.policyVersion);
        uint16 referralBps = request.referrer == address(0) ? 0 : referralShares[request.referrer];
        settled.referralFee = settled.netFee * referralBps / BPS;
        settled.treasuryFee = settled.netFee - settled.referralFee;
        uint256 nonce = ++settlementNonce;
        receiptId = keccak256(abi.encode(block.chainid, address(this), nonce, request.quoteId));
        _accrueFee(request.tokenIn, request.referrer, settled.referralFee);
        _accrueFee(request.tokenIn, treasury, settled.treasuryFee);

        _collectInput(request.tokenIn, request.amountIn, permitInput);
        uint256 currentAmount = settled.routedInput;
        bytes32 combinedRouteId = bytes32(0);

        for (uint256 i; i < steps.length; ++i) {
            RouteStep memory step = steps[i];
            AdapterConfig memory config = adapters[step.adapter];
            bytes32 expectedCodehash = adapterCodehashes[step.adapter];
            bytes32 actualCodehash = step.adapter.codehash;
            if (expectedCodehash == bytes32(0) || actualCodehash != expectedCodehash) {
                revert AdapterCodehashMismatch(step.adapter, expectedCodehash, actualCodehash);
            }
            // Routes are signature-bound and hard-capped at four steps; each balance read proves settlement.
            // slither-disable-next-line calls-loop
            uint256 beforeOutput = _balanceOf(step.tokenOut, address(this));
            uint256 reportedOut;
            address hook;
            bytes32 stepRouteId;

            if (step.tokenIn == address(0)) {
                // slither-disable-next-line calls-loop
                (reportedOut, hook, stepRouteId) = IPermAdapter(step.adapter).swapExactInput{value: currentAmount}(
                    step.tokenIn, step.tokenOut, currentAmount, address(this), step.data
                );
            } else {
                IERC20(step.tokenIn).forceApprove(step.adapter, currentAmount);
                // slither-disable-next-line calls-loop
                (reportedOut, hook, stepRouteId) = IPermAdapter(step.adapter).swapExactInput(
                    step.tokenIn, step.tokenOut, currentAmount, address(this), step.data
                );
                IERC20(step.tokenIn).forceApprove(step.adapter, 0);
            }

            // slither-disable-next-line calls-loop
            uint256 actualOut = _balanceOf(step.tokenOut, address(this)) - beforeOutput;
            if (reportedOut != actualOut) revert AdapterOutputMismatch(reportedOut, actualOut);
            // Zero is the exact invalid sentinel; this is not a threshold comparison.
            // slither-disable-next-line incorrect-equality
            if (actualOut == 0) revert InvalidAmount();
            bytes32 settledProviderId = hook == address(0) ? config.providerId : hookProviderIds[step.adapter];
            if (settledProviderId == bytes32(0)) revert InvalidRoute();
            combinedRouteId = keccak256(abi.encode(combinedRouteId, settledProviderId, stepRouteId));
            emit RouteStepSettled(
                receiptId,
                uint8(i),
                settledProviderId,
                step.adapter,
                step.tokenIn,
                step.tokenOut,
                currentAmount,
                actualOut,
                stepRouteId,
                hook,
                hook == address(0) ? bytes32(0) : hook.codehash
            );
            currentAmount = actualOut;
        }

        settled.amountOut = _deliverOutput(request.tokenOut, request.recipient, currentAmount, request.minAmountOut);

        emit SwapSettled(
            receiptId,
            request.quoteId,
            msg.sender,
            request.recipient,
            request.tokenIn,
            request.tokenOut,
            request.amountIn,
            settled.routedInput,
            settled.amountOut,
            settled.grossFee,
            settled.rebate,
            settled.netFee,
            settled.referralFee,
            settled.treasuryFee,
            request.policyVersion,
            combinedRouteId,
            keccak256(request.routeData)
        );
    }

    function claimFees(address token, address recipient) external nonReentrant returns (uint256 amount) {
        if (recipient == address(0)) revert InvalidAddress();
        amount = claimableFees[token][msg.sender];
        if (amount == 0) revert InvalidAmount();
        claimableFees[token][msg.sender] = 0;
        totalClaimableFees[token] -= amount;
        _transfer(token, recipient, amount);
        emit FeeClaimed(token, msg.sender, recipient, amount);
    }

    function rescueExcess(address token, address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert InvalidAddress();
        uint256 balance = _balanceOf(token, address(this));
        uint256 reserved = totalClaimableFees[token];
        uint256 available = balance > reserved ? balance - reserved : 0;
        if (amount > available) revert InsufficientExcess(available, amount);
        _transfer(token, recipient, amount);
        emit ExcessRescued(token, recipient, amount);
    }

    function publishFeePolicy(uint32 version, uint16 platformFeeBps, uint16 rebateShareBps, bool enabled)
        external
        onlyOwner
    {
        _publishFeePolicy(version, platformFeeBps, rebateShareBps, enabled);
    }

    function setActiveFeePolicy(uint32 version) external onlyOwner {
        FeePolicy memory policy = feePolicies[version];
        if (!policy.exists || !policy.enabled) revert PolicyUnavailable(version);
        uint32 previous = activePolicyVersion;
        activePolicyVersion = version;
        emit ActiveFeePolicyChanged(previous, version);
    }

    function setFeePolicyEnabled(uint32 version, bool enabled) external onlyOwner {
        FeePolicy storage policy = feePolicies[version];
        if (!policy.exists) revert PolicyUnavailable(version);
        if (!enabled && version == activePolicyVersion) revert InvalidFeePolicy();
        policy.enabled = enabled;
        emit FeePolicyStatusChanged(version, enabled);
    }

    function configureAdapter(address adapter, bytes32 providerId, bool enabled) external onlyOwner {
        bytes32 codehash = adapter.codehash;
        if (adapter == address(0) || adapter.code.length == 0 || codehash == bytes32(0) || providerId == bytes32(0)) {
            revert InvalidAddress();
        }
        adapters[adapter] = AdapterConfig({enabled: enabled, providerId: providerId});
        adapterCodehashes[adapter] = codehash;
        emit AdapterConfigured(adapter, providerId, enabled, codehash);
    }

    function configureHookProvider(address adapter, bytes32 providerId) external onlyOwner {
        if (adapter == address(0) || !adapters[adapter].enabled) revert InvalidAddress();
        hookProviderIds[adapter] = providerId;
        emit HookProviderConfigured(adapter, providerId);
    }

    function configureReferral(address referrer, uint16 shareBpsOfNetFee) external onlyOwner {
        if (referrer == address(0) || shareBpsOfNetFee > BPS) revert InvalidFeePolicy();
        referralShares[referrer] = shareBpsOfNetFee;
        emit ReferralConfigured(referrer, shareBpsOfNetFee);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidAddress();
        emit TreasuryChanged(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setQuoteSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert InvalidAddress();
        emit QuoteSignerChanged(quoteSigner, newSigner);
        quoteSigner = newSigner;
    }

    function setPauseGuardian(address newGuardian) external onlyOwner {
        if (newGuardian == address(0)) revert InvalidAddress();
        emit PauseGuardianChanged(pauseGuardian, newGuardian);
        pauseGuardian = newGuardian;
    }

    /// @notice Emergency stop callable immediately by governance or its designated guardian.
    function pause() external {
        if (msg.sender != owner() && msg.sender != pauseGuardian) revert UnauthorizedPauseGuardian(msg.sender);
        _pause();
    }

    /// @notice Resuming settlement remains an owner/timelock-only action.
    function unpause() external onlyOwner {
        _unpause();
    }

    function _publishFeePolicy(uint32 version, uint16 platformFeeBps, uint16 rebateShareBps, bool enabled) internal {
        if (
            version == 0 || feePolicies[version].exists || platformFeeBps > MAX_PLATFORM_FEE_BPS
                || rebateShareBps > BPS
        ) revert InvalidFeePolicy();
        feePolicies[version] = FeePolicy(platformFeeBps, rebateShareBps, enabled, true);
        emit FeePolicyPublished(version, platformFeeBps, rebateShareBps, enabled);
    }

    // Binding checks stay together so every externally supplied quote field is audited in one place.
    // slither-disable-next-line cyclomatic-complexity
    function _validateRequest(SwapRequest calldata request, bytes calldata signature) internal view {
        if (request.chainId != block.chainid) revert ChainMismatch(request.chainId, block.chainid);
        // Timestamps are intentionally used for signed quote expiry with a narrow 120-second window.
        // slither-disable-next-line timestamp
        if (request.deadline < block.timestamp) revert DeadlineExpired();
        // slither-disable-next-line timestamp
        if (request.quotedAt > block.timestamp) revert QuoteFromFuture();
        // slither-disable-next-line timestamp
        if (block.timestamp - request.quotedAt > MAX_QUOTE_AGE) revert QuoteStale();
        if (request.amountIn == 0 || request.quoteId == bytes32(0) || request.gasEstimate == 0) revert InvalidAmount();
        if (request.amountIn > uint256(uint128(type(int128).max)) || request.gasEstimate > MAX_QUOTED_GAS) revert AmountTooLarge();
        if (request.tokenIn == request.tokenOut) revert InvalidPair();
        if (request.recipient == address(0) || request.recipient == address(this)) revert InvalidAddress();
        if (request.referrer != address(0) && request.referrer == msg.sender) revert SelfReferral();
        if (consumedQuotes[request.quoteId]) revert AlreadyConsumed(request.quoteId);
        bytes32 expectedQuoteId = quoteIdFor(msg.sender, request);
        if (request.quoteId != expectedQuoteId) revert QuoteBindingMismatch(request.quoteId, expectedQuoteId);
        address recovered = ECDSA.recover(expectedQuoteId, signature);
        if (recovered != quoteSigner) revert InvalidQuoteSigner(recovered, quoteSigner);
    }

    function _validateRoute(SwapRequest calldata request, RouteStep[] memory steps) internal view {
        if (steps.length == 0 || steps.length > MAX_ROUTE_STEPS) revert InvalidRoute();
        if (steps[0].tokenIn != request.tokenIn || steps[steps.length - 1].tokenOut != request.tokenOut) {
            revert InvalidRoute();
        }
        for (uint256 i; i < steps.length; ++i) {
            RouteStep memory step = steps[i];
            if (
                step.adapter == address(0) || step.tokenIn == step.tokenOut || !adapters[step.adapter].enabled
                    || (i != 0 && steps[i - 1].tokenOut != step.tokenIn)
            ) revert InvalidRoute();
        }
    }

    function _collectInput(address token, uint256 amount, PermitInput calldata permitInput) internal {
        if (token == address(0)) {
            if (msg.value != amount || permitInput.signature.length != 0) revert InvalidNativeValue();
            return;
        }
        if (msg.value != 0) revert InvalidNativeValue();
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        if (permitInput.signature.length == 0) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        } else {
            // Permit2 authorization expiry is necessarily timestamp based.
            // slither-disable-next-line timestamp
            if (permitInput.deadline < block.timestamp) revert InvalidPermit();
            IPermit2.PermitTransferFrom memory permit = IPermit2.PermitTransferFrom({
                permitted: IPermit2.TokenPermissions({token: token, amount: amount}),
                nonce: permitInput.nonce,
                deadline: permitInput.deadline
            });
            IPermit2.SignatureTransferDetails memory transferDetails =
                IPermit2.SignatureTransferDetails({to: address(this), requestedAmount: amount});
            permit2.permitTransferFrom(permit, transferDetails, msg.sender, permitInput.signature);
        }
        if (IERC20(token).balanceOf(address(this)) - beforeBalance != amount) {
            revert FeeOnTransferInputUnsupported();
        }
    }

    function _deliverOutput(address token, address recipient, uint256 amount, uint256 minimum)
        internal
        returns (uint256 actualReceived)
    {
        if (amount < minimum) revert OutputBelowMinimum(amount, minimum);
        if (token == address(0)) {
            // Recipient is bound by the authorized EIP-712 quote; nonReentrant protects callback execution.
            // slither-disable-next-line arbitrary-send-eth,low-level-calls
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert TransferFailed();
            return amount;
        }
        uint256 beforeRecipient = IERC20(token).balanceOf(recipient);
        IERC20(token).safeTransfer(recipient, amount);
        actualReceived = IERC20(token).balanceOf(recipient) - beforeRecipient;
        if (actualReceived < minimum) revert OutputBelowMinimum(actualReceived, minimum);
    }

    function _accrueFee(address token, address beneficiary, uint256 amount) internal {
        if (amount == 0) return;
        claimableFees[token][beneficiary] += amount;
        totalClaimableFees[token] += amount;
        emit FeeAccrued(token, beneficiary, amount);
    }

    function _transfer(address token, address recipient, uint256 amount) internal {
        if (token == address(0)) {
            // Claim recipients are chosen by the beneficiary; rescue recipients by the owner.
            // slither-disable-next-line arbitrary-send-eth,low-level-calls
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    // Called inside the hard-capped route loop to independently verify every adapter output.
    // slither-disable-next-line calls-loop
    function _balanceOf(address token, address account) internal view returns (uint256) {
        return token == address(0) ? account.balance : IERC20(token).balanceOf(account);
    }
}
