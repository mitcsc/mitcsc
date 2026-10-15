import { redirect } from "next/navigation";
import { SECTIONS, sectionHref } from "@/components/dashboard/nav";

export default function DashboardHome() {
  redirect(sectionHref(SECTIONS[0]));
}
