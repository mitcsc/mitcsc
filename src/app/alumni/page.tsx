import AlumniYears from "@/components/AlumniYears";
import Header from "@/components/Header";
import PeopleGallery from "@/components/PeopleGallery";
import Join from "@/components/home/Join";
import { publicCards } from "@/lib/exec";

// Rebuilt when exec change the roster in the dashboard (EXEC_TAG), and at least hourly.
export const revalidate = 3600;

export default async function AlumniPage() {
  return (
    <section className="w-full min-h-screen flex flex-col h-auto items-center">
      <Header title="our legacy" />
      <PeopleGallery people={await publicCards("alumni")} />
      <AlumniYears />
      <Join />
    </section>
  );
}
