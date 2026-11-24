import { RHC_CANONICAL_ASSETS } from "./constants.js";
import type { ContentCheckResult, ContentFinding, ContentInput } from "./types.js";

/**
 * Shape-based prompt-injection / agent-manipulation patterns (§6.4 Dev Brief).
 * Matches structural instruction patterns, invisible Unicode, and Stock Token ticker impersonation.
 */
const SHAPE_RULES: Array<{ id: string; severity: "high" | "medium"; regex: RegExp; desc: string }> = [
  {
    id: "PROMPT_OVERRIDE",
    severity: "high",
    regex: /\b(ignore|disregard|forget|override)\s+(all\s+)?(previous|prior|above|system|developer|safety)\s+(instructions?|prompts?|rules?|policies?)\b/i,
    desc: "Instruction override directive targeting an autonomous agent",
  },
  {
    id: "ROLE_TAG_SPOOF",
    severity: "high",
    regex: /(<\s*\/?\s*(system|assistant|developer|tool_call|tool_result|function_calls|claude|cursor)\b[^>]*>|\[\s*(SYSTEM|INST|ADMIN_OVERRIDE)\s*\])/i,
    desc: "Markup/delimiter tag spoofing agent conversation roles or tool output",
  },
  {
    id: "FUND_REDIRECT_DIRECTIVE",
    severity: "high",
    regex: /\b(send|transfer|wire|forward|approve|delegate|drain)\s+(all\s+|your\s+|the\s+)?(funds?|balance|usdg|usdc|weth|eth|tokens?|wallet)\s+(to|into)\s+0x[a-fA-F0-9]{6,}/i,
    desc: "Embedded fund-transfer or approval instruction inside untrusted text",
  },
  {
    id: "SIGNER_BYPASS_DIRECTIVE",
    severity: "high",
    regex: /\b(bypass|disable|skip|ignore)\s+(the\s+)?(zguard|guard|wormhole|simulation|quote[-_\s]?match|signer)\b/i,
    desc: "Directive attempting to disable or bypass guard/signer verification",
  },
  {
    id: "HIDDEN_CALLDATA_INSTRUCTION",
    severity: "medium",
    regex: /\b(call|execute|invoke)\s+(approve|permit|setApprovalForAll|transferOwnership)\s*\(/i,
    desc: "Inline contract call directive inside metadata or untrusted text",
  },
  {
    id: "DATA_EXFIL_URL",
    severity: "medium",
    regex: /https?:\/\/[^\s"'<>]*(api[_-]?key|private[_-]?key|seed|mnemonic|authorization=|bearer\s+)/i,
    desc: "URL query containing credential/key exfiltration pattern",
  },
];

// Zero-width, bidirectional override, and invisible formatting codepoints (§6.3.7 & §6.4)
const INVISIBLE_CHAR_REGEX = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\u034F\u061C\u180E]/u;

// Mixed-script Cyrillic/Greek homoglyphs commonly used to spoof Latin tickers (A, B, C, E, H, K, M, O, P, T, X, Y)
const CONFUSABLE_HOMOGLYPH_REGEX = /[\u0410\u0412\u0421\u0415\u041D\u041A\u041C\u041E\u0420\u0422\u0425\u0423\u0430\u0435\u043E\u0440\u0441\u0443\u0445\u0391\u0392\u0395\u0397\u0399\u039A\u039C\u039D\u039F\u03A1\u03A4\u03A7\u03A5]/u;

export interface KnownCanonicalTickerMap {
  /** Uppercase symbol -> canonical RHC 4663 contract address (lowercased) */
  [symbolUpper: string]: string;
}

const DEFAULT_CANONICAL_TICKERS: KnownCanonicalTickerMap = {
  USDG: RHC_CANONICAL_ASSETS.USDG.address.toLowerCase(),
  WETH: RHC_CANONICAL_ASSETS.WETH.address.toLowerCase(),
};

/**
 * Scans untrusted text, token metadata, or URLs before an agent consumes them (§6.3.7 & §6.4).
 * Never emits "safe" — returns verdict: "clean_by_rules" | "findings" | "unchecked".
 */
export function scanContent(
  input?: ContentInput,
  canonicalTickers: KnownCanonicalTickerMap = {}
): ContentCheckResult {
  if (!input) {
    return {
      decision: "allow",
      verdict: "unchecked",
      codes: [],
    };
  }

  const combinedParts = [input.name, input.symbol, input.text, input.url].filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0
  );

  if (combinedParts.length === 0) {
    return {
      decision: "allow",
      verdict: "unchecked",
      codes: [],
    };
  }

  const findings: ContentFinding[] = [];
  const fullText = combinedParts.join("\n");

  if (INVISIBLE_CHAR_REGEX.test(fullText)) {
    findings.push({
      rule: "INVISIBLE_UNICODE",
      severity: "high",
      detail: "Contains zero-width, soft-hyphen, or bidirectional override Unicode characters",
    });
  }

  if (CONFUSABLE_HOMOGLYPH_REGEX.test(fullText)) {
    findings.push({
      rule: "HOMOGLYPH_CONFUSABLE",
      severity: "high",
      detail: "Contains Cyrillic/Greek homoglyph characters that visually spoof Latin letters",
    });
  }

  for (const rule of SHAPE_RULES) {
    if (rule.regex.test(fullText)) {
      findings.push({
        rule: rule.id,
        severity: rule.severity,
        detail: rule.desc,
      });
    }
  }

  // Ticker lookalike / impersonation check against official Stock Token registry & canonical assets (§6.4)
  if (input.symbol) {
    const mergedMap: KnownCanonicalTickerMap = {
      ...DEFAULT_CANONICAL_TICKERS,
      ...canonicalTickers,
    };
    const normalizedSymbol = input.symbol.trim().toUpperCase().replace(/^\$/, "");
    const canonicalAddress = mergedMap[normalizedSymbol];
    if (canonicalAddress && input.tokenAddress) {
      if (input.tokenAddress.trim().toLowerCase() !== canonicalAddress.toLowerCase()) {
        findings.push({
          rule: "TICKER_IMPERSONATION",
          severity: "high",
          detail: `Symbol "${normalizedSymbol}" matches canonical RHC asset (${canonicalAddress}), but contract address ${input.tokenAddress} is NOT the official registry contract`,
        });
      }
    }
  }

  if (findings.length > 0) {
    const hasHigh = findings.some((f) => f.severity === "high");
    return {
      decision: hasHigh ? "deny" : "abstain",
      verdict: "findings",
      codes: ["C-FINDING"],
      findings,
    };
  }

  return {
    decision: "allow",
    verdict: "clean_by_rules",
    codes: [],
    findings: [],
  };
}
