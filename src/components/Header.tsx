"use client";

export default function Header({ title }: { title: string }) {
  return (
    <section className="w-full flex flex-col items-center relative pt-24 sm:pt-28 md:pt-40 lg:pt-44 xl:pt-48 text-center">
      <h2 className="text-[min(30vw,500px)] max-w-7xl leading-[0.8] font-primary font-bold">
        {title}
      </h2>
    </section>
  );
}
