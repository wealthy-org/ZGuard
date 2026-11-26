import { RHC_CANONICAL_ASSETS, RHC_TESTNET_ASSETS } from "./constants.js";
import type { ContentCheckResult, ContentFinding, ContentInput } from "./types.js";

/**
 * Shape-based prompt-injection / agent-manipulation patterns (§6.4 Dev Brief).
 * Matches structural instruction patterns, invisible Unicode, and Stock Token ticker impersonation.
 */
const SHAPE_RULES: Array<{ id: string; severity: "high" | "medium"; regex: RegExp; desc: string }> = [
  {
    id: "PROMPT_OVERRIDE",
    severity: "high",
    // CS-4: also "ignore all (of) the/your previous instructions", "earlier", "directions", "guidelines".
    regex: /\b(ignore|disregard|forget|override)\s+(all\s+)?(of\s+)?(the\s+|your\s+|my\s+|any\s+|these\s+)?(previous|prior|above|earlier|preceding|system|developer|safety)\s+(instructions?|prompts?|rules?|polic(?:y|ies)|directions?|guidelines?|messages?)\b/i,
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
    // CS-6: an explicit amount ("transfer 100 USDG to 0x…") is a directive too.
    regex: /\b(send|transfer|wire|forward|approve|delegate|drain)\s+(all\s+|your\s+|the\s+|[\d][\d.,_]*\s+)?(funds?|balance|usdg|usdc|weth|eth|tokens?|wallet)\s+(to|into)\s+0x[a-fA-F0-9]{6,}/i,
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

// Zero-width, bidirectional override, invisible formatting, fillers and variation selectors (§6.3.7 & §6.4).
// CS-3: Default_Ignorable_Code_Point covers U+00AD, U+034F, U+061C, U+115F/U+1160, U+17B4/5, U+180B–U+180F,
// U+200B–U+200F, U+202A–U+202E, U+2060–U+206F, U+3164, U+FE00–U+FE0F, U+FEFF, U+FFA0, U+E0000–U+E0FFF;
// U+2800 (braille blank) is added explicitly.
const INVISIBLE_CHAR_REGEX = /[\p{Default_Ignorable_Code_Point}\u2800]/u;
const INVISIBLE_CHAR_GLOBAL = /[\p{Default_Ignorable_Code_Point}\u2800]/gu;
// CS-1: Unicode tag characters (U+E0020–U+E007E) mirror ASCII invisibly ("ASCII smuggling").
const TAG_CHAR_GLOBAL = /[\u{E0020}-\u{E007E}]/gu;

// Mixed-script Cyrillic/Greek homoglyphs commonly used to spoof Latin letters.
const CONFUSABLE_HOMOGLYPH_REGEX = /[\u0410\u0412\u0421\u0415\u041D\u041A\u041C\u041E\u0420\u0422\u0425\u0423\u0430\u0435\u043E\u0440\u0441\u0443\u0445\u0391\u0392\u0395\u0397\u0399\u039A\u039C\u039D\u039F\u03A1\u03A4\u03A7\u03A5\u0405\u0406\u0408\u0455\u0456\u0458\u0501\u04BB\u04CF\u03BF]/u;

// CS-5: fold the confusables above to Latin so rules also match "іgnore previous instructions".
const HOMOGLYPH_FOLD: Record<string, string> = {
  "\u0410": "A", "\u0412": "B", "\u0421": "C", "\u0415": "E", "\u041D": "H", "\u041A": "K", "\u041C": "M",
  "\u041E": "O", "\u0420": "P", "\u0422": "T", "\u0425": "X", "\u0423": "Y", "\u0430": "a", "\u0435": "e",
  "\u043E": "o", "\u0440": "p", "\u0441": "c", "\u0443": "y", "\u0445": "x", "\u0391": "A", "\u0392": "B",
  "\u0395": "E", "\u0397": "H", "\u0399": "I", "\u039A": "K", "\u039C": "M", "\u039D": "N", "\u039F": "O",
  "\u03A1": "P", "\u03A4": "T", "\u03A7": "X", "\u03A5": "Y", "\u0405": "S", "\u0406": "I", "\u0408": "J",
  "\u0455": "s", "\u0456": "i", "\u0458": "j", "\u0501": "d", "\u04BB": "h", "\u04CF": "l", "\u03BF": "o",
};
const HOMOGLYPH_FOLD_REGEX = new RegExp(`[${Object.keys(HOMOGLYPH_FOLD).join("")}]`, "gu");

// Legitimate emoji sequences that use otherwise-invisible code points: VS16/VS15 after a pictograph or
// keycap base, ZWJ between pictographs (family/profession emoji), and subdivision flags (🏴 + tags + U+E007F).
const EMOJI_SEQUENCE_GLOBAL =
  /\u{1F3F4}[\u{E0061}-\u{E007A}]{2,6}\u{E007F}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0E\uFE0F]?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?(?:\p{Emoji_Modifier})?)*/gu;

/** Removes well-formed emoji sequences so their joiners/selectors are not reported as hidden text. */
function stripEmojiSequences(text: string): string {
  return text.replace(EMOJI_SEQUENCE_GLOBAL, " ");
}

/** Decodes Unicode tag characters back to the ASCII they hide. */
function decodeTagChars(text: string): string {
  return Array.from(text.matchAll(TAG_CHAR_GLOBAL), (m) => String.fromCharCode(m[0].codePointAt(0)! - 0xe0000)).join("");
}

/**
 * CS-2: canonical view used for rule matching: NFKC (fullwidth / mathematical alphanumerics → ASCII),
 * invisible characters removed, Cyrillic/Greek confusables folded to Latin.
 */
export function normalizeForScan(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE_CHAR_GLOBAL, "")
    .replace(HOMOGLYPH_FOLD_REGEX, (c) => HOMOGLYPH_FOLD[c] ?? c);
}

export interface KnownCanonicalTickerMap {
  /** Uppercase symbol -> canonical RHC 4663 contract address (lowercased) */
  [symbolUpper: string]: string;
}

const DEFAULT_CANONICAL_TICKERS: KnownCanonicalTickerMap = {
  USDG: RHC_CANONICAL_ASSETS.USDG.address.toLowerCase(),
  WETH: RHC_CANONICAL_ASSETS.WETH.address.toLowerCase(),
};

// CS-6: the testnet (46630) canonical assets are not impersonations of the mainnet ones.
const DEFAULT_CANONICAL_ALTERNATES: Record<string, string[]> = {
  USDG: [RHC_TESTNET_ASSETS.USDG.address.toLowerCase()],
  WETH: [RHC_TESTNET_ASSETS.WETH.address.toLowerCase()],
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

  const withoutEmoji = stripEmojiSequences(fullText);
  const tagPayload = decodeTagChars(withoutEmoji);
  if (tagPayload.length > 0) {
    findings.push({
      rule: "UNICODE_TAG_SMUGGLING",
      severity: "high",
      detail: `Contains ${tagPayload.length} invisible Unicode tag characters hiding the text "${tagPayload.slice(0, 120)}"`,
    });
  }

  if (INVISIBLE_CHAR_REGEX.test(withoutEmoji)) {
    findings.push({
      rule: "INVISIBLE_UNICODE",
      severity: "high",
      detail: "Contains zero-width, soft-hyphen, filler, variation-selector, or bidirectional override Unicode characters",
    });
  }

  if (CONFUSABLE_HOMOGLYPH_REGEX.test(fullText)) {
    findings.push({
      rule: "HOMOGLYPH_CONFUSABLE",
      severity: "high",
      detail: "Contains Cyrillic/Greek homoglyph characters that visually spoof Latin letters",
    });
  }

  // Rules run on the raw text, the normalized view (NFKC, invisibles stripped, homoglyphs folded) and any
  // text hidden in tag characters, so obfuscation cannot hide a directive.
  const views = [fullText, normalizeForScan(fullText), tagPayload].filter((v) => v.length > 0);
  for (const rule of SHAPE_RULES) {
    if (views.some((v) => rule.regex.test(v))) {
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
    const normalizedSymbol = normalizeForScan(input.symbol).trim().toUpperCase().replace(/^\$/, "");
    const canonicalAddress = mergedMap[normalizedSymbol];
    if (canonicalAddress && input.tokenAddress) {
      const addr = input.tokenAddress.trim().toLowerCase();
      const alternates = canonicalTickers[normalizedSymbol] ? [] : DEFAULT_CANONICAL_ALTERNATES[normalizedSymbol] ?? [];
      if (addr !== canonicalAddress.toLowerCase() && !alternates.includes(addr)) {
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
