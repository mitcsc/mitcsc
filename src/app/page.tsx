import Hero from "@/components/Hero";
import About from "@/components/About";
import Join from "@/components/Join";

export default function Home() {
  return (
    <section className="w-full min-h-screen flex flex-col h-auto">
      <Hero />
      <About />
      <Join />
    </section>
  );
}
