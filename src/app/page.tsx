import Hero from "@/components/home/Hero";
import About from "@/components/home/About";
import Join from "@/components/home/Join";

/**
 * The hero picks a random set of photos on the server so they are in the
 * initial HTML. The page renders on every request, so each visit and each
 * reload shows a new set. The photo list itself stays cached (see homePagePhotos).
 */
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <section className="w-full min-h-screen flex flex-col items-center h-auto">
      <Hero />
      <About />
      <Join />
    </section>
  );
}
