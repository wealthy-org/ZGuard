module.exports = {
  // The chain-46630-only fixture cannot execute on the default chain-31337 unit network.
  // It has a separate latest-state fork coverage gate in contracts:coverage:test-hook.
  skipFiles: [
    "test/PermTestAggregatorHook.sol",
    "mocks/MockTestAggregatorV3Pool.sol",
  ],
};
