import Photos from "@/components/Photos";
import { getImageFiles } from "@/lib/images";

export default async function Hero() {
  const images = await getImageFiles();

  return (
    <section className="w-full flex flex-col h-screen items-center justify-center">
      <div className="flex flex-col w-full xl:max-w-[85vw] pt-36 md:pt-52 lg:pt-56 xl:pt-64">
        <div className="flex flex-col px-8 justify-center">
          <h1 className="text-6xl md:text-8xl lg:text-8xl xl:text-[10vw] leading-[0.5]">
            chinese student's club
          </h1>
          <p className="text-base md:text-lg lg:text-xl xl:text-2xl font-secondary font-normal text-secondary">
            The <span className="italic text-primary">premier</span> cultural
            club for experiencing Chinese-American culture at MIT
          </p>
        </div>
      </div>
      <Photos images={images} />
    </section>
  );
}
