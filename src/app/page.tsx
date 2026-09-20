import Hero from "@/components/home/Hero";
import About from "@/components/home/About";
import Join from "@/components/home/Join";

/**
 * The hero picks a random set of photos on the server so they are in the
 * initial HTML. Regenerate the cached page every minute so visitors keep
 * seeing a fresh selection while the CDN still serves static HTML.
 */
export const revalidate = 60;

export default function Home() {
  return (
    <section className="w-full min-h-screen flex flex-col items-center h-auto">
      <Hero />
      <About />
      <Join />
    </section>
  );
}
