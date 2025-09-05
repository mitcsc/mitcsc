"use client";

import Header from "@/components/Header";
import PeopleGallery from "@/components/PeopleGallery";
import Join from "@/components/home/Join";
import { current, directory } from "@/config/exec/current";

export default function ExecPage() {
  return (
    <section className="w-full min-h-screen flex flex-col h-auto">
      <Header title="who we are" />
      <PeopleGallery directory={directory} people={current} />
      <Join />
    </section>
  );
}
