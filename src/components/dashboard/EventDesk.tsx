import type { Person } from "@/app/dashboard/actions";
import { formatDay } from "@/lib/membership/config";
import { formatHours } from "@/lib/membership/event-times";
import { sheetUrl } from "@/lib/membership/google/drive";
import { listAttendance, listMembers } from "@/lib/membership/store";
import type { EventInfo } from "@/lib/membership/types";
import CheckInDesk from "./CheckInDesk";

// The check-in page for one event, on the Check in tab or opened from the Events tab.
export default async function EventDesk({ event, back }: { event: EventInfo; back: { href: string; label: string } | null }) {
  const [records, members] = await Promise.all([listAttendance(event.id), listMembers(event.year)]);
  const people: Person[] = members.map((m) => ({
    kerb: m.kerb, name: m.name, classYear: m.classYear, price: m.price, method: m.method, paid: m.status === "paid", reportedAt: m.reportedAt,
  }));
  return (
    <CheckInDesk
      event={{
        id: event.id, name: event.name, when: [formatDay(event.date), formatHours(event)].filter(Boolean).join(", "), sheet: event.sheetId ? sheetUrl(event.sheetId) : null,
        hours: { date: event.date, starts: event.starts ?? null, ends: event.ends ?? null, checkIn: event.checkIn ?? null, checkInAt: event.checkInAt ?? null, createdAt: event.createdAt },
      }}
      records={records}
      people={people}
      renderedAt={Date.now()}
      back={back}
    />
  );
}
