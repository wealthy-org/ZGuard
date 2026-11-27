import type { Hex } from "viem";

export type RuntimeArtifact = {
  deployedBytecode: string;
  deployedBytecodeImmutableReferences?: ReadonlyArray<{ start: number; length: number }>;
};

function normalizeRuntime(value: string, references: RuntimeArtifact["deployedBytecodeImmutableReferences"]) {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) return undefined;
  const bytes = value.slice(2).toLowerCase().split("");
  for (const reference of references || []) {
    const start = reference.start * 2;
    const end = start + reference.length * 2;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > bytes.length) return undefined;
    bytes.fill("0", start, end);
  }
  return bytes.join("");
}

/** Compares deployed code to the audited compilation template while ignoring only
 * compiler-declared immutable slots (constructor values are verified separately). */
export function runtimeMatchesArtifact(code: Hex | undefined, artifact: RuntimeArtifact) {
  if (!code || code === "0x" || !artifact.deployedBytecode) return false;
  const references = artifact.deployedBytecodeImmutableReferences || [];
  const normalizedCode = normalizeRuntime(code, references);
  const normalizedTemplate = normalizeRuntime(artifact.deployedBytecode, references);
  return normalizedCode !== undefined && normalizedTemplate !== undefined && normalizedCode === normalizedTemplate;
}
