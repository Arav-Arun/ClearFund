// Formats a bigint wei value to a human-readable ETH string

import { ethers } from "ethers";

export function formatEth(
  value: bigint,
  maxDecimals = 4
): string {
  const raw = ethers.formatEther(value);
  const num = Number(raw);

  if (!Number.isFinite(num)) return "0";

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(num);
}
