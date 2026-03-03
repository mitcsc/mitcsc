import { getLinks } from "@/lib/links";
import LinkList from "./LinkList";

export default async function LinksPage() {
  const links = await getLinks();

  return (
    <section className="w-full flex-1 flex flex-col items-center pt-32 md:pt-44 pb-16 px-6">
      <div className="w-full max-w-xl flex flex-col items-center gap-8">
        <h1 className="text-5xl md:text-6xl font-primary font-bold tracking-wide text-center">
          Useful Links
        </h1>

        <LinkList initialLinks={links} />
      </div>
    </section>
  );
}
