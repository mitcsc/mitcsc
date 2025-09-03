"use client";
import { Link } from "@/components/Link";
import { motion, Variants } from "framer-motion";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

const menuItems = [
  { name: "About", href: "/#about" },
  { name: "Exec", href: "/exec" },
  { name: "Alumni", href: "/alumni" },
  { name: "Contact", href: "/contact" },
];

const springTransition = {
  type: "spring" as const,
  stiffness: 200,
  damping: 30,
  duration: 0.5,
};

const menuVariants: Variants = {
  closed: {
    y: "-100%",
    transition: { ...springTransition }, // Slightly stiffer for closing
  },
  open: {
    y: 0,
    transition: {
      ...springTransition,
      when: "beforeChildren",
    },
  },
};

const childVariants = {
  closed: { opacity: 0, y: 50 },
  open: { opacity: 1, y: 0 },
};

export default function Nav() {
  const router = useRouter();
  const [prevScrollPos, setPrevScrollPos] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const toggleMenu = () => {
    if (isOpen) {
      document.body.style.overflowY = "auto";
    } else {
      document.body.style.overflowY = "hidden";
    }
    setIsOpen(!isOpen);
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 500);
  };

  const handleScroll = useCallback(() => {
    if (isOpen) return;

    if (frameRef.current) cancelAnimationFrame(frameRef.current);

    frameRef.current = requestAnimationFrame(() => {
      const { scrollY } = window;
      const atTop = scrollY <= 100;
      const atBottom =
        scrollY >=
        document.documentElement.scrollHeight - window.innerHeight - 100;

      if (navRef.current) {
        navRef.current.style.translate =
          atTop || atBottom || prevScrollPos > scrollY ? "0 0%" : "0 -300%";
      }

      setPrevScrollPos(scrollY);
    });
  }, [isOpen, prevScrollPos]);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [handleScroll]);

  return (
    <>
      <nav
        ref={navRef}
        className={`fixed z-[11] top-4 w-full xl:max-w-[85vw] pl-3 pr-8 flex items-center justify-between transition-all duration-1000 ease-in-out`}
      >
        <Link href={"/"} onClick={() => router.replace("/")}>
          <img
            src="/logo.png"
            alt="MIT CSC"
            className="w-16 md:w-24 lg:w-32 aspect-square h-auto drop-shadow-lg brightness-100 hover:brightness-75 transition-all ease-out duration-300"
          />
        </Link>
        <button
          onClick={toggleMenu}
          className="mt-4 text-4xl md:text-5xl lg:text-6xl drop-shadow-lg cursor-pointer hover:text-secondary transition-colors ease-out duration-300"
        >
          {isOpen ? "close" : "menu"}
        </button>
      </nav>
      <motion.div
        initial="closed"
        animate={isOpen ? "open" : "closed"}
        variants={menuVariants}
        className="fixed inset-0 bg-primary flex items-center justify-center z-10 origin-top"
      >
        <motion.ul
          className="space-y-8 text-center"
          variants={{
            open: {
              transition: { staggerChildren: 0.1 },
            },
          }}
        >
          {menuItems.map((item) => (
            <motion.li
              key={item.name}
              variants={childVariants}
              transition={springTransition}
            >
              <motion.div
                className="cursor-pointer text-white text-5xl md:text-7xl lg:text-8xl font-TokyoDreamsHybrid duration-300 hover:text-secondary transition-colors inline-block"
                onClick={() => {
                  router.push(item.href);
                  toggleMenu();
                }}
                whileHover={{ x: 10 }}
                whileTap={{ scale: 0.95 }}
                transition={springTransition}
              >
                {item.name}
              </motion.div>
            </motion.li>
          ))}
        </motion.ul>
      </motion.div>
    </>
  );
}
