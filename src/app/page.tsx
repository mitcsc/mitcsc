import Hero from "@/components/home/Hero";
import About from "@/components/home/About";
import Join from "@/components/home/Join";

export default function Home() {
  return (
    <section className="w-full min-h-screen flex flex-col h-auto">
      <Hero />
      <About />
      <Join />
    </section>
  );
}
