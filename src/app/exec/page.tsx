import Header from "@/components/Header";
import PeopleGallery from "@/components/PeopleGallery";
import Join from "@/components/home/Join";
import { publicCards } from "@/lib/exec";

// Rebuilt when exec change the roster in the dashboard (EXEC_TAG), and at least hourly.
export const revalidate = 3600;

export default async function ExecPage() {
  return (
    <section className="w-full min-h-screen flex flex-col h-auto">
      <Header title="who we are" />
      <PeopleGallery people={await publicCards("current")} />
      <Join />
    </section>
  );
}
