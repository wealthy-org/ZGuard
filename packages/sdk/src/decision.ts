import type {
  CheckMode,
  CheckName,
  ContentCheckResult,
  Decision,
  QuoteCheckResult,
  ReasonCode,
  SimulationCheckResult,
  TokenRiskCheckResult,
} from "./types.js";

export interface AggregationInput {
  checks: {
    quote?: QuoteCheckResult;
    simulation?: SimulationCheckResult;
    token_risk?: TokenRiskCheckResult;
    content?: ContentCheckResult;
  };
  modes?: Partial<Record<CheckName, CheckMode>>;
  /**
   * Checks the caller (server policy) REQUIRES to have been executed. Any name listed here that is
   * missing from `checks` is treated as a required `abstain` ("not executed"), and its mode is forced
   * to `required` regardless of `modes`. This stops clients from dropping required checks (gap C4).
   */
  requiredChecks?: CheckName[];
  ttlSeconds?: number;
  nowMs?: number;
}

export interface AggregatedDecision {
  decision: Decision;
  reason: string;
  codes: ReasonCode[];
  flags: string[];
  expires_at: string | null;
}

/**
 * Sanitizes summary text so ZGuard NEVER claims a token or transaction is "safe" (§1.2 & §5.3).
 */
export function sanitizeVerdictReason(text: string): string {
  return text.replace(/\bsafe\b/gi, "within-rules");
}

/**
 * Aggregates individual check verdicts per §4.5 Dev Brief:
 * - Any `required` check = `deny` -> effective `deny`
 * - No `required` `deny`, but any `required` check = `abstain` -> effective `abstain`
 * - All `required` checks = `allow` -> effective `allow` with hash-bound `expires_at`
 * - Any `advisory` check = `deny` or `abstain` -> appended to `flags[]` without downgrading `allow`
 */
export function aggregateDecision(input: AggregationInput): AggregatedDecision {
  const defaultModes: Record<CheckName, CheckMode> = {
    quote: "required",
    simulation: "required",
    token_risk: "required",
    content: "advisory",
    ...input.modes,
  };
  const enforced = input.requiredChecks ?? [];
  for (const name of enforced) {
    defaultModes[name] = "required";
  }

  const ttlSeconds = input.ttlSeconds ?? 120;
  const nowMs = input.nowMs ?? Date.now();

  const entries = Object.entries(input.checks).filter(
    ([, val]) => val !== undefined
  ) as Array<[CheckName, { decision: Decision; codes: ReasonCode[] }]>;

  const missingRequired = enforced.filter((name) => input.checks[name] === undefined);

  if (entries.length === 0) {
    return {
      decision: "abstain",
      reason: "no checks executed (fail-closed abstain)",
      codes: ["Q-005"],
      flags: [],
      expires_at: null,
    };
  }

  const allCodes = new Set<ReasonCode>();
  const flags: string[] = [];
  const requiredDenies: string[] = [];
  const requiredAbstains: string[] = [];
  const requiredAllows: string[] = [];

  for (const name of missingRequired) {
    requiredAbstains.push(`${name} not executed (required by server policy)`);
  }

  for (const [name, result] of entries) {
    const mode = defaultModes[name] ?? "required";
    for (const c of result.codes) {
      if (mode === "required") {
        allCodes.add(c);
      } else {
        flags.push(`${name}:${c}`);
      }
    }

    if (mode === "required") {
      if (result.decision === "deny") {
        requiredDenies.push(
          `${name} denied${result.codes.length ? ` (${result.codes.join(", ")})` : ""}`
        );
      } else if (result.decision === "abstain") {
        requiredAbstains.push(
          `${name} abstained${result.codes.length ? ` (${result.codes.join(", ")})` : ""}`
        );
      } else {
        requiredAllows.push(name);
      }
    } else if (result.decision !== "allow") {
      flags.push(`${name}:${result.decision}`);
    }
  }

  let decision: Decision;
  let reason: string;

  if (requiredDenies.length > 0) {
    decision = "deny";
    reason = requiredDenies.join(" · ");
  } else if (requiredAbstains.length > 0) {
    decision = "abstain";
    reason = requiredAbstains.join(" · ");
  } else if (requiredAllows.length > 0) {
    decision = "allow";
    reason = `${requiredAllows.join(" · ")} verified on chain`;
  } else {
    decision = "abstain";
    reason = "no required checks evaluated";
  }

  const expires_at =
    decision === "allow" ? new Date(nowMs + ttlSeconds * 1000).toISOString() : null;

  return {
    decision,
    reason: sanitizeVerdictReason(reason),
    codes: Array.from(allCodes),
    flags,
    expires_at,
  };
}
