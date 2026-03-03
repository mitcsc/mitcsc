"use client";

import { motion } from "framer-motion";
import Header from "@/components/Header";
import PeopleGallery from "@/components/PeopleGallery";
import Join from "@/components/home/Join";
import { alumni, directory, pastAlumni } from "@/config/exec/alumni";

export default function AlumniPage() {
  return (
    <section className="w-full min-h-screen flex flex-col h-auto items-center">
      <Header title="our legacy" />
      <PeopleGallery directory={directory} people={alumni} />
      <div className="w-full xl:max-w-7xl px-6 md:px-12 py-16 space-y-10">
        {pastAlumni.map(({ year, names }, groupIndex) => (
          <motion.div
            key={year}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: groupIndex * 0.03 }}
          >
            <div className="flex items-center gap-4 mb-4">
              <h3 className="text-3xl md:text-4xl font-bold font-primary tracking-wide shrink-0">
                {year}
              </h3>
              <div className="flex-1 h-[2px] bg-primary" />
            </div>
            <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-8">
              {names.map((name, nameIndex) => (
                <motion.li
                  key={name}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.3,
                    ease: "easeOut",
                    delay: groupIndex * 0.03 + nameIndex * 0.02,
                  }}
                  className="text-secondary uppercase text-xl md:text-2xl leading-loose break-inside-avoid font-secondary font-normal"
                >
                  {name}
                </motion.li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
      <Join />
    </section>
  );
}
