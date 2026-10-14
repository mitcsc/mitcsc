import { redirect } from "next/navigation";
import { SECTIONS } from "@/components/dashboard/nav";

export default function DashboardHome() {
  redirect(SECTIONS[0].href);
}
