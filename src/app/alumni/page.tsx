import Header from "@/components/Header";
import PeopleGallery from "@/components/PeopleGallery";
import Join from "@/components/home/Join";
import { alumni, directory } from "@/config/exec/alumni";

export default function AlumniPage() {
  return (
    <section className="w-full min-h-screen flex flex-col h-auto">
      <Header title="our legacy" />
      <PeopleGallery directory={directory} people={alumni} />
      <Join />
    </section>
  );
}
