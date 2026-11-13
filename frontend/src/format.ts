import { ethers } from "ethers";

export const USDC_DECIMALS = 6;

export function usd(value: bigint, decimals = 2) {
  const n = Number(ethers.formatUnits(value, USDC_DECIMALS));
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(n);
}

export function parseUsd(value: string) {
  try {
    return ethers.parseUnits(value.replace(/[$,\s]/g, "") || "0", USDC_DECIMALS);
  } catch {
    return 0n;
  }
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string) {
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

export function date(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(seconds: number) {
  return new Date(seconds * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function timeLeft(seconds: number) {
  if (seconds <= 0) return "ended";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${Math.max(minutes, 1)}m left`;
}

/// Seconds from a date input (YYYY-MM-DD) taken as the end of that day in the user's time zone.
export function endOfDay(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d, 23, 59, 59).getTime() / 1000);
}

// Calendar alarms are opt-in; importing this file does not subscribe the donor to a service.
export function reviewCalendar(campaign: string, index: number, end: number, url: string) {
  const stamp = (s: number) => new Date(s * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ClearFund//Review reminder//EN", "BEGIN:VEVENT",
    `UID:${campaign.toLowerCase()}-${index}@clearfund`, `DTSTAMP:${stamp(Math.floor(Date.now() / 1000))}`,
    `DTSTART:${stamp(end - 3600)}`, `DTEND:${stamp(end)}`, "SUMMARY:Review your ClearFund milestone",
    `DESCRIPTION:Withdraw before the review closes if you disagree. Silence permits payment. ${url}`,
    `URL:${url}`, "BEGIN:VALARM", "TRIGGER:-PT23H", "ACTION:DISPLAY", "DESCRIPTION:Review closes in 24 hours",
    "END:VALARM", "BEGIN:VALARM", "TRIGGER:PT0S", "ACTION:DISPLAY", "DESCRIPTION:Review closes in one hour",
    "END:VALARM", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}
