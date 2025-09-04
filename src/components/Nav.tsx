"use client";

import { Link } from "@/components/home/Link";
import { motion, Variants } from "framer-motion";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { nav } from "@/config/links";

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
  const [logo, setLogo] = useState<string>("/img/logo/logo.png");
  const [pandaRotations, setPandaRotations] = useState<{
    [key: string]: number;
  }>({});

  useEffect(() => {
    const randomNum = Math.floor(Math.random() * 5);
    if (randomNum === 0) setLogo("/img/logo/logo-with-panda.png");
  }, []);

  const generateNewRotation = (itemName: string) => {
    const newRotation = Math.random() * 90 - 45;
    setPandaRotations((prev) => ({
      ...prev,
      [itemName]: newRotation,
    }));
  };

  const router = useRouter();
  const [prevScrollPos, setPrevScrollPos] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const toggleMenu = () => {
    if (isOpen) {
      document.body.style.overflowY = "auto";
    } else {
      document.body.style.overflowY = "hidden";
    }
    setIsOpen(!isOpen);
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
        <Link
          href={"/"}
          onClick={() => {
            if (window.location.hash !== "") {
              router.replace("/");
            }
            if (isOpen) {
              toggleMenu();
            }
          }}
        >
          <img
            src={logo}
            alt="MIT CSC"
            title="MIT CSC"
            className="w-16 md:w-24 lg:w-32 aspect-square h-auto drop-shadow-lg brightness-100 hover:brightness-75 transition-all ease-out duration-300"
          />
        </Link>
        <button
          onClick={toggleMenu}
          className="text-4xl md:text-5xl lg:text-6xl drop-shadow-lg cursor-pointer hover:text-secondary transition-colors ease-out duration-300"
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
          {nav.map((item) => (
            <motion.li
              key={item.name}
              variants={childVariants}
              transition={springTransition}
              className="relative flex items-center justify-center"
            >
              <div className="flex items-center justify-center w-full gap-4">
                <div className="w-[40px] md:w-[48px] lg:w-[56px]" />
                <div className="group relative">
                  <div className="absolute -left-16 top-1/2 -translate-y-1/2 opacity-0 group-hover:translate-x-4 group-hover:opacity-100 transition-all duration-300 pointer-events-none">
                    <img
                      src="/img/logo/panda.png"
                      alt="MIT CSC"
                      draggable={false}
                      className="w-10 h-10 select-none md:w-12 md:h-12 lg:w-14 lg:h-14 object-contain transition-transform duration-200"
                      style={{
                        transform: `rotate(${
                          pandaRotations[item.name] || 0
                        }deg)`,
                      }}
                    />
                  </div>
                  <motion.div
                    className="cursor-pointer text-white text-5xl md:text-7xl lg:text-8xl duration-300 transition-colors"
                    onClick={() => {
                      router.push(`/${item.href}`);
                      toggleMenu();
                    }}
                    whileHover={{ x: 10 }}
                    whileTap={{ scale: 0.95 }}
                    transition={springTransition}
                    onMouseEnter={() => generateNewRotation(item.name)}
                  >
                    {item.name}
                  </motion.div>
                </div>
                <div className="w-[40px] md:w-[48px] lg:w-[56px]" />
              </div>
            </motion.li>
          ))}
        </motion.ul>
      </motion.div>
    </>
  );
}
