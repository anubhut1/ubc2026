// Money normalization. This is the ONLY place decimals are converted.
//
// Internal unit: micro-USDC (6 decimals), as a JS number (safe to ~$9e9).
// Arc gotcha: native USDC (gas token) on Arc uses 18 decimals, while the USDC
// ERC-20 interface uses 6. TODO(verify) against docs/RESEARCH.md.

export const MICRO_PER_USD = 1_000_000;
export const ARC_NATIVE_DECIMALS = 18;
export const USDC_ERC20_DECIMALS = 6;
const NATIVE_PER_MICRO = 10n ** BigInt(ARC_NATIVE_DECIMALS - USDC_ERC20_DECIMALS); // 1e12

/** "$1.25" / 1.25 → 1_250_000. Rounds to the nearest micro to avoid float dust. */
export function usdToMicro(usd: number | string): number {
  const n = typeof usd === "string" ? Number(usd.replace(/[$,\s]/g, "")) : usd;
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid USD amount: ${usd}`);
  return Math.round(n * MICRO_PER_USD);
}

export function microToUsd(micro: number): number {
  return micro / MICRO_PER_USD;
}

/** 1_250_000 → "$1.25"; sub-cent amounts keep up to 6 decimals ("$0.0025"). */
export function formatUsd(micro: number): string {
  const sign = micro < 0 ? "-" : "";
  const abs = Math.abs(micro);
  const dollars = Math.floor(abs / MICRO_PER_USD);
  const frac = abs % MICRO_PER_USD;
  let fracStr = frac.toString().padStart(6, "0");
  // Keep at least 2 decimals, trim trailing zeros beyond that.
  fracStr = fracStr.replace(/0+$/, "").padEnd(2, "0");
  return `${sign}$${dollars.toLocaleString("en-US")}.${fracStr}`;
}

/** micro-USDC → ERC-20 base units (6 decimals). Identity, but explicit and bigint. */
export function microToErc20(micro: number): bigint {
  assertSafeMicro(micro);
  return BigInt(micro);
}

export function erc20ToMicro(units: bigint): number {
  const n = Number(units);
  assertSafeMicro(n);
  return n;
}

/** micro-USDC → Arc native units (18 decimals). */
export function microToArcNative(micro: number): bigint {
  assertSafeMicro(micro);
  return BigInt(micro) * NATIVE_PER_MICRO;
}

/** Arc native units (18 decimals) → micro-USDC. Throws on sub-micro dust rather than silently truncating. */
export function arcNativeToMicro(wei: bigint): number {
  if (wei < 0n) throw new Error("negative amount");
  if (wei % NATIVE_PER_MICRO !== 0n) throw new Error(`amount ${wei} has sub-micro-USDC precision`);
  const n = Number(wei / NATIVE_PER_MICRO);
  assertSafeMicro(n);
  return n;
}

function assertSafeMicro(micro: number) {
  if (!Number.isSafeInteger(micro) || micro < 0) throw new Error(`invalid micro-USDC amount: ${micro}`);
}
