import { notFound } from "next/navigation";
import type { Person } from "@/app/dashboard/actions";
import CheckInDesk from "@/components/dashboard/CheckInDesk";
import { formatDay } from "@/lib/membership/config";
import { sheetUrl } from "@/lib/membership/google/drive";
import { getEvent, listAttendance, listMembers } from "@/lib/membership/store";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const event = await getEvent((await params).id);
  if (!event) notFound();
  const [records, members] = await Promise.all([listAttendance(event.id), listMembers(event.year)]);
  const people: Person[] = members.map((m) => ({
    kerb: m.kerb, name: m.name, classYear: m.classYear, price: m.price, method: m.method, paid: m.status === "paid", reportedAt: m.reportedAt,
  }));
  return (
    <CheckInDesk
      event={{ id: event.id, name: event.name, date: formatDay(event.date), sheet: event.sheetId ? sheetUrl(event.sheetId) : null }}
      records={records}
      people={people}
    />
  );
}
