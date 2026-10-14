"use client";

import type { CheckInResult, Person } from "@/app/dashboard/actions";
import { Icon } from "@/components/membership/icons";
import { formatTime, money } from "@/lib/membership/config";
import { ago, METHOD_NAMES } from "./format";

export function CheckedInPill({ at, big = false }: { at: number; big?: boolean }) {
  return (
    <span className={`m-pill is-green${big ? " is-big" : ""}`} suppressHydrationWarning>
      <Icon name="check" size={big ? 14 : 12} strokeWidth={2.6} />Checked in {formatTime(at)}
    </span>
  );
}

export function oweNote(person: Person) {
  const how = person.method === "cash" ? "in cash" : `by ${METHOD_NAMES[person.method]}`;
  return `Owes ${money(person.price)} ${how}.${person.reportedAt ? ` Picked ${ago(person.reportedAt)}.` : ""}`;
}

export type Admit = (kerb: string, mode: "check-in" | "confirm" | "anyway") => Promise<CheckInResult | null>;
