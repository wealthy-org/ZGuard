/**
 * Minimal Solana wire-transaction decoder (legacy + v0 messages) used to derive the
 * approve/set-authority flag from the actual instructions instead of trusting a caller boolean
 * (gap J: "flag Solana dihitung dari instruksi yang di-decode").
 */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => B58[d]).join("");
}

export const SOLANA_PROGRAMS = {
  TOKEN: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  TOKEN_2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PE6vMwnpiAQgX7",
  ASSOCIATED_TOKEN: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  COMPUTE_BUDGET: "ComputeBudget111111111111111111111111111111",
  MEMO: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
} as const;

export interface DecodedSolanaInstruction {
  programId: string;
  accounts: string[]; // static keys only (lookup-table accounts are reported as "lut:<index>")
  data: Uint8Array;
}

function decodeBase64(s: string): Uint8Array {
  const bin = atob(s.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

class Reader {
  constructor(private buf: Uint8Array, public pos = 0) {}
  u8(): number {
    if (this.pos >= this.buf.length) throw new Error("eof");
    return this.buf[this.pos++]!;
  }
  bytes(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) throw new Error("eof");
    const b = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  compactU16(): number {
    let len = 0;
    for (let shift = 0; shift < 21; shift += 7) {
      const b = this.u8();
      len |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return len;
    }
    throw new Error("bad compact-u16");
  }
}

/** Decodes a base64 serialized Solana transaction. Throws on malformed input. */
export function decodeSolanaTransaction(base64Tx: string): DecodedSolanaInstruction[] {
  const r = new Reader(decodeBase64(base64Tx));
  const sigCount = r.compactU16();
  r.bytes(64 * sigCount);
  let first = r.u8();
  if (first & 0x80) {
    if ((first & 0x7f) !== 0) throw new Error("unsupported message version");
    first = r.u8(); // numRequiredSignatures
  }
  r.u8(); // numReadonlySigned
  r.u8(); // numReadonlyUnsigned
  const keyCount = r.compactU16();
  const keys: string[] = [];
  for (let i = 0; i < keyCount; i++) keys.push(base58Encode(r.bytes(32)));
  r.bytes(32); // recent blockhash
  const ixCount = r.compactU16();
  const ixs: DecodedSolanaInstruction[] = [];
  for (let i = 0; i < ixCount; i++) {
    const programIdx = r.u8();
    const programId = keys[programIdx];
    if (!programId) throw new Error("program id must be a static account key");
    const accCount = r.compactU16();
    const accounts: string[] = [];
    for (let j = 0; j < accCount; j++) {
      const idx = r.u8();
      accounts.push(keys[idx] ?? `lut:${idx - keyCount}`);
    }
    const dataLen = r.compactU16();
    ixs.push({ programId, accounts, data: r.bytes(dataLen) });
  }
  return ixs;
}

export interface SolanaTransferAnalysis {
  /** Approve / ApproveChecked / SetAuthority on an SPL token program. */
  hasApproveOrSetAuthority: boolean;
  /** Instructions outside the one-shot transfer allow-list (unknown programs, mint/burn/close, …). */
  disallowed: string[];
  transfers: { kind: "transfer" | "transferChecked"; amount: bigint; mint: string | null; destination: string }[];
}

function u64le(b: Uint8Array, off: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[off + i] ?? 0);
  return v;
}

export function analyzeSolanaTransfer(ixs: DecodedSolanaInstruction[]): SolanaTransferAnalysis {
  const res: SolanaTransferAnalysis = { hasApproveOrSetAuthority: false, disallowed: [], transfers: [] };
  ixs.forEach((ix, i) => {
    const p = ix.programId;
    if (p === SOLANA_PROGRAMS.COMPUTE_BUDGET || p === SOLANA_PROGRAMS.MEMO) return;
    if (p === SOLANA_PROGRAMS.ASSOCIATED_TOKEN) {
      // Create (0 / empty) and CreateIdempotent (1) only; RecoverNested (2) moves funds.
      const tag = ix.data.length === 0 ? 0 : ix.data[0];
      if (tag !== 0 && tag !== 1) res.disallowed.push(`#${i} associated-token instruction ${tag}`);
      return;
    }
    if (p === SOLANA_PROGRAMS.TOKEN || p === SOLANA_PROGRAMS.TOKEN_2022) {
      const tag = ix.data[0];
      if (tag === 4 || tag === 13 || tag === 6) {
        res.hasApproveOrSetAuthority = true;
        return;
      }
      if (tag === 3 && ix.data.length >= 9) {
        res.transfers.push({ kind: "transfer", amount: u64le(ix.data, 1), mint: null, destination: ix.accounts[1] ?? "" });
        return;
      }
      if (tag === 12 && ix.data.length >= 10) {
        res.transfers.push({
          kind: "transferChecked",
          amount: u64le(ix.data, 1),
          mint: ix.accounts[1] ?? null,
          destination: ix.accounts[2] ?? "",
        });
        return;
      }
      res.disallowed.push(`#${i} token instruction ${tag ?? "empty"}`);
      return;
    }
    res.disallowed.push(`#${i} program ${p}`);
  });
  return res;
}
