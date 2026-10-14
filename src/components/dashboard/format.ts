import type { PaymentMethod } from "@/lib/membership/types";

export const METHOD_NAMES: Record<PaymentMethod, string> = { venmo: "Venmo", zelle: "Zelle", cash: "Cash" };

// "just now", "4 min ago", "3 h ago", "2 days ago".
export function ago(ms: number, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function paidLabel(paidVia: PaymentMethod | null, method: PaymentMethod) {
  const via = paidVia || method;
  return via === "cash" ? "Paid in cash" : `Paid by ${METHOD_NAMES[via]}`;
}

export function confirmLabel(method: PaymentMethod) {
  return `Confirm ${method === "cash" ? "cash" : METHOD_NAMES[method]} received`;
}

// "achen@mit.edu" becomes "achen".
export function shortEmail(email: string) {
  return email.split("@")[0];
}
