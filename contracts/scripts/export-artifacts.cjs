const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const contracts = [
  ['PermRouter', 'contracts/artifacts/contracts/src/PermRouter.sol/PermRouter.json'],
  ['PermV4Adapter', 'contracts/artifacts/contracts/src/adapters/PermV4Adapter.sol/PermV4Adapter.json'],
  ['PermV3Adapter', 'contracts/artifacts/contracts/src/adapters/PermV3Adapter.sol/PermV3Adapter.json'],
  ['PermV2Adapter', 'contracts/artifacts/contracts/src/adapters/PermV2Adapter.sol/PermV2Adapter.json'],
  ['PermTimelock', 'contracts/artifacts/contracts/src/PermTimelock.sol/PermTimelock.json'],
];
for (const [name, relative] of contracts) {
  const artifactPath = path.join(root, relative);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const debugPath = artifactPath.replace(/\.json$/, '.dbg.json');
  const debug = JSON.parse(fs.readFileSync(debugPath, 'utf8'));
  const buildInfo = JSON.parse(fs.readFileSync(path.resolve(path.dirname(debugPath), debug.buildInfo), 'utf8'));
  const immutableGroups = buildInfo.output.contracts[artifact.sourceName][artifact.contractName]
    .evm.deployedBytecode.immutableReferences || {};
  const deployedBytecodeImmutableReferences = Object.values(immutableGroups).flat()
    .map(({ start, length }) => ({ start, length }))
    .sort((a, b) => a.start - b.start);
  const minimal = {
    contractName: artifact.contractName,
    sourceName: artifact.sourceName,
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    deployedBytecode: artifact.deployedBytecode,
    deployedBytecodeImmutableReferences,
  };
  fs.writeFileSync(path.join(root, `lib/web3/artifacts/${name}.json`), `${JSON.stringify(minimal)}\n`);
  console.log(`Exported ${name}`);
}
