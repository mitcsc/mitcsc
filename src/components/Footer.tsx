export default function Footer() {
  return (
    <footer className="w-full h-24 flex items-center justify-center gap-8 xl:max-w-[85vw] px-8 py-16">
      
      <div className="flex flex-col items-center justify-center">
        <a
          href="https://stanleyzhao.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-2xl md:text-2xl lg:text-3xl hover:text-secondary transition-colors ease-out duration-300"
        >
          Crafted by SZ
        </a>
        <a
          href="https://accessibility.mit.edu/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs md:text-sm lg:text-base uppercase underline text-secondary hover:text-primary transition-colors ease-out duration-300 font-secondary"
        >
          Accessibility
        </a>
      </div>
    </footer>
  );
}
