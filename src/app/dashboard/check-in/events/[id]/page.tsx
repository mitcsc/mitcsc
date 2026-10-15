import { notFound } from "next/navigation";
import EventDesk from "@/components/dashboard/EventDesk";
import { getEvent } from "@/lib/membership/store";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const event = await getEvent((await params).id);
  if (!event) notFound();
  return <EventDesk event={event} back={{ href: "/dashboard/check-in/events", label: "Events" }} />;
}
