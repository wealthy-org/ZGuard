import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const v4QuoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);

export const v3FactoryAbi = parseAbi([
  "function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)",
]);

export const v3QuoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);

export const v2FactoryAbi = parseAbi([
  "function getPair(address tokenA,address tokenB) view returns (address pair)",
]);

export const v2PairAbi = parseAbi([
  "function factory() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)",
]);

export const permV2AdapterAbi = parseAbi([
  "function permRouter() view returns (address)",
  "function factory() view returns (address)",
  "function weth() view returns (address)",
  "function pairCodehash() view returns (bytes32)",
]);

export const permV4AdapterAbi = parseAbi([
  "function verifiedHooks(address hook) view returns (bool)",
  "function verifiedHookCodehashes(address hook) view returns (bytes32)",
  "function poolManager() view returns (address)",
  "function permRouter() view returns (address)",
]);

export const permV3AdapterAbi = parseAbi([
  "function permRouter() view returns (address)",
  "function swapRouter() view returns (address)",
  "function weth() view returns (address)",
  "function swapRouterCodehash() view returns (bytes32)",
  "function wethCodehash() view returns (bytes32)",
]);

export const permRouterAbi = parseAbi([
  "function swapExactInput((address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,uint256 gasEstimate,address recipient,uint256 deadline,uint64 quotedAt,uint32 policyVersion,uint256 chainId,bytes32 quoteId,address referrer,bytes routeData) request,bytes quoteSignature,(uint256 nonce,uint256 deadline,bytes signature) permitInput) payable returns (bytes32 receiptId,(uint256 grossFee,uint256 rebate,uint256 netFee,uint256 referralFee,uint256 treasuryFee,uint256 routedInput,uint256 amountOut) settled)",
  "function quoteIdFor(address account,(address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,uint256 gasEstimate,address recipient,uint256 deadline,uint64 quotedAt,uint32 policyVersion,uint256 chainId,bytes32 quoteId,address referrer,bytes routeData) request) view returns (bytes32)",
  "function previewFees(uint256 amountIn,uint32 policyVersion) view returns (uint256 grossFee,uint256 rebate,uint256 netFee,uint256 routedInput)",
  "function activePolicyVersion() view returns (uint32)",
  "function feePolicies(uint32 version) view returns (uint16 platformFeeBps,uint16 rebateShareBps,bool enabled,bool exists)",
  "function adapters(address adapter) view returns (bool enabled,bytes32 providerId)",
  "function adapterCodehashes(address adapter) view returns (bytes32 codehash)",
  "function hookProviderIds(address adapter) view returns (bytes32 providerId)",
  "function configureHookProvider(address adapter,bytes32 providerId)",
  "function quoteSigner() view returns (address)",
  "function pauseGuardian() view returns (address)",
  "function setPauseGuardian(address newGuardian)",
  "function permit2() view returns (address)",
  "function treasury() view returns (address)",
  "function referralShares(address referrer) view returns (uint16)",
  "function claimableFees(address token,address beneficiary) view returns (uint256)",
  "function claimFees(address token,address recipient) returns (uint256 amount)",
  "function configureAdapter(address adapter,bytes32 providerId,bool enabled)",
  "function owner() view returns (address)",
  "event RouteStepSettled(bytes32 indexed receiptId,uint8 indexed stepIndex,bytes32 indexed providerId,address adapter,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,bytes32 stepRouteId,address hook,bytes32 hookCodehash)",
  "event SwapSettled(bytes32 indexed receiptId,bytes32 indexed quoteId,address indexed account,address recipient,address tokenIn,address tokenOut,uint256 amountIn,uint256 routedInput,uint256 amountOut,uint256 grossFee,uint256 rebate,uint256 netFee,uint256 referralFee,uint256 treasuryFee,uint32 policyVersion,bytes32 routeId,bytes32 routeHash)",
]);

export const permRouterV1Abi = parseAbi([
  "event SwapSettled(bytes32 indexed receiptId,bytes32 indexed quoteId,address indexed account,address recipient,address tokenIn,address tokenOut,uint256 amountIn,uint256 routedInput,uint256 amountOut,uint256 grossFee,uint256 rebate,uint256 netFee,uint256 referralFee,uint32 policyVersion,bytes32 providerId,address adapter,address hook)",
]);

export const permit2Abi = parseAbi([
  "function permitTransferFrom(((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit,(address to,uint256 requestedAmount) transferDetails,address owner,bytes signature)",
]);
