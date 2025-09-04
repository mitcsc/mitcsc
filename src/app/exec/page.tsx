import Hero from "@/components/exec/Hero";
import Exec from "@/components/exec/Exec";
import Join from "@/components/home/Join";

export default function ExecPage() {
  return (
    <section className="w-full min-h-screen flex flex-col h-auto">
      <Hero />
      <Exec />
      <Join />
    </section>
  );
}
