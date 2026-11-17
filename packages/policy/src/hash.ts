import { keccak256, toHex } from "viem";
import type { Rule } from "./types";

/** JSON with recursively sorted object keys and no whitespace. Arrays keep order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortKeys(val);
    }
    return out;
  }
  return v;
}

/** Rules are sorted by id so that reordering the list does not change the hash. */
export function canonicalRules(rules: Rule[]): string {
  return canonicalJson([...rules].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

/** keccak256 of the canonical JSON of the rules. This is what gets committed to PolicyRegistry. */
export function policyHash(rules: Rule[]): `0x${string}` {
  return keccak256(toHex(canonicalRules(rules)));
}

/** Short string ids (agentId, requestId, ruleId) → bytes32 for contract calls. */
export function idToBytes32(id: string): `0x${string}` {
  return keccak256(toHex(id));
}
