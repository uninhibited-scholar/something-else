// Risk classification for queued instructions.
//
// The key safety property of runtime steering is that we only ever inject a new
// instruction *between* tool rounds — a running tool is never interrupted. This
// classifier adds a second layer: an instruction that itself asks for something
// destructive ("rm -rf /", "DROP TABLE users") is held back from automatic
// injection and surfaced to a human instead of being silently fused into the
// live plan.

import { InterruptPolicy, RiskLevel } from "./types.js";
import type { RiskVerdict } from "./types.js";

const HIGH_RISK_KEYWORDS = [
  "rm -rf",
  "rmdir",
  "shutil.rmtree",
  "unlink",
  "mkfs",
  "chmod",
  "chown",
  "sudo",
  "drop table",
  "delete from",
  "truncate",
  "exploit",
  "reverse shell",
  "/etc/shadow",
  "/etc/passwd",
];

const MEDIUM_RISK_KEYWORDS = [
  "update ",
  "insert into",
  "alter table",
  "git push",
  "git reset --hard",
  "force push",
  "deploy",
  "production",
  "prod ",
];

const HIGH_RISK_PATTERNS: RegExp[] = [
  /rm\s+-[a-z]*[rf]/i, // rm -rf, rm -fr, rm -r
  /dd\s+if=.*of=\/(?:dev|$)/i, // dd to a device
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/, // fork bomb
  /\bcurl\b[^|]*\|\s*(?:bash|sh)\b/i, // curl | sh
];

const POLICY_BY_LEVEL: Record<RiskLevel, InterruptPolicy> = {
  [RiskLevel.LOW]: InterruptPolicy.ALLOW,
  [RiskLevel.MEDIUM]: InterruptPolicy.QUEUE,
  [RiskLevel.HIGH]: InterruptPolicy.DENY,
};

export function classifyInstruction(content: string): RiskVerdict {
  const text = content.toLowerCase();

  for (const re of HIGH_RISK_PATTERNS) {
    if (re.test(content)) {
      return verdict(RiskLevel.HIGH, `matched destructive pattern ${re}`);
    }
  }
  for (const kw of HIGH_RISK_KEYWORDS) {
    if (text.includes(kw)) {
      return verdict(RiskLevel.HIGH, `contains high-risk token "${kw.trim()}"`);
    }
  }
  for (const kw of MEDIUM_RISK_KEYWORDS) {
    if (text.includes(kw)) {
      return verdict(RiskLevel.MEDIUM, `contains sensitive token "${kw.trim()}"`);
    }
  }
  return verdict(RiskLevel.LOW, "no risky tokens detected");
}

function verdict(level: RiskLevel, reason: string): RiskVerdict {
  return { level, policy: POLICY_BY_LEVEL[level], reason };
}
