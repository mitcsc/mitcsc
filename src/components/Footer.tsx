import { instagramLink, emailLink, email } from "@/config/links";

export default function Footer() {
  return (
    <footer className="w-full relative h-24 flex items-center justify-center gap-8 xl:max-w-7xl px-8 py-16">
      <a
        href={emailLink}
        className="absolute left-8 sm:left-12 text-2xl md:text-3xl lg:text-4xl hover:text-secondary transition-colors ease-out duration-300 group"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="group-hover:hidden">Email</span>
        <span className="hidden group-hover:inline">{email}</span>
      </a>
      <div className="flex flex-col items-center justify-center">
        <a
          href="https://stanleyzhao.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-2xl md:text-3xl lg:text-4xl hover:text-secondary transition-colors ease-out duration-300"
        >
          Crafted by SZ
        </a>
        <a
          href="https://accessibility.mit.edu/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs md:text-sm lg:text-base uppercase underline text-secondary hover:text-primary transition-colors ease-out duration-300 font-extralight"
        >
          Accessibility
        </a>
      </div>
      <a
        href={instagramLink}
        className="absolute right-8 sm:right-12 text-2xl md:text-3xl lg:text-4xl hover:text-secondary transition-colors ease-out duration-300"
        target="_blank"
        rel="noopener noreferrer"
      >
        Instagram
      </a>
    </footer>
  );
}
