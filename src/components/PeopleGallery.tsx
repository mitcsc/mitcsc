"use client";

import { motion } from "framer-motion";
import { useState, useMemo, useEffect } from "react";
import PeopleCard from "@/components/PeopleCard";
import { PeopleCardProps } from "@/components/PeopleCard";

interface PeopleGalleryProps {
  directory: string;
  people: Omit<PeopleCardProps, "directory">[];
}

export default function PeopleGallery({
  directory,
  people,
}: PeopleGalleryProps) {
  const [itemsPerRow, setItemsPerRow] = useState<null | number>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const windowWidth = window.innerWidth;
      if (windowWidth < 384) setItemsPerRow(1);
      if (windowWidth < 584) setItemsPerRow(2);
      if (windowWidth < 640) setItemsPerRow(3);
      if (windowWidth < 680) setItemsPerRow(2);
      if (windowWidth < 768) setItemsPerRow(3);
      if (windowWidth < 776) setItemsPerRow(2);
      if (windowWidth < 1040) setItemsPerRow(3);
      setItemsPerRow(4);
    }
  }, []);

  return (
    itemsPerRow && (
      <section className="w-full h-auto min-h-screen flex flex-col items-center py-16 overflow-hidden">
        <div className="flex flex-wrap gap-4 w-full xl:max-w-7xl items-center justify-center">
          {people.map((exec, index) => (
            <motion.div
              key={exec.name}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.3,
                ease: "easeOut",
                delay: (index % itemsPerRow) * 0.05,
              }}
              viewport={{ once: true, amount: 0.1 }}
            >
              <PeopleCard {...exec} directory={directory} />
            </motion.div>
          ))}
        </div>
      </section>
    )
  );
}
