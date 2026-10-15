"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { Fragment } from "react";

export interface PeopleCardProps {
  name: string;
  position: string;
  classYear: string;
  hometown: string;
  // The photo's URL, or null for a person without a photo.
  src: string | null;
  // A tiny copy of the photo as a data URL, shown blurred until the photo loads.
  placeholder?: string;
  alumni: boolean;
}

export default function PeopleCard({
  name,
  position,
  classYear,
  hometown,
  src,
  placeholder,
  alumni: isAlumni,
}: PeopleCardProps) {
  return (
    <motion.div
      className="relative bg-white p-3 pb-4 group drop-shadow-lg transition-transform duration-300 hover:scale-105"
      whileHover={{ scale: 1.01 }}
    >
      <div className="w-40 h-40 sm:w-48 sm:h-48 md:w-56 md:h-56 overflow-hidden relative bg-black mb-3">
        {src && (
          <Image
            src={src}
            alt={`${name} - ${position}`}
            width={256}
            height={256}
            quality={75}
            sizes="(max-width: 640px) 160px, (max-width: 768px) 192px, 224px"
            className="w-full h-full object-cover"
            loading="lazy"
            {...(placeholder ? { placeholder: "blur" as const, blurDataURL: placeholder } : {})}
          />
        )}
        <Image
          src={`/img/logo/${isAlumni ? "alumni-" : ""}panda.png`}
          alt="MIT CSC"
          width={80}
          height={80}
          draggable={false}
          className={
            isAlumni
              ? "w-20 -rotate-30 -bottom-6 -right-5.5 group-hover:-translate-x-1 group-hover:-translate-y-1 h-auto group-hover:scale-110 drop-shadow-lg aspect-square absolute ease-out duration-300 object-cover"
              : "w-20 rotate-45 group-hover:translate-x-1 group-hover:-translate-y-1 -bottom-6 -left-6 h-auto group-hover:scale-110 drop-shadow-lg aspect-square absolute ease-out duration-300 object-cover"
          }
        />
      </div>
      {/* Every card has the same size: the photo sets the width (w-0 min-w-full keeps the text from widening it),
          the name takes one line, the position two, and the class year and hometown one. */}
      <div className="w-0 min-w-full text-center text-black">
        <h3 className="text-3xl font-bold leading-tightest tracking-wide whitespace-nowrap">{name}</h3>
        <p className="min-h-[2lh] text-sm text-primary leading-tightest tracking-tightest uppercase font-secondary font-normal [overflow-wrap:anywhere]">
          {/* "Treasurer/Merch Chair" may break after the slash. */}
          {position.split("/").map((part, i) => (
            <Fragment key={i}>{i > 0 && <>/<wbr /></>}{part}</Fragment>
          ))}
        </p>
        <div className="mt-3 flex justify-between gap-2 px-1 text-lg leading-tight tracking-wide whitespace-nowrap">
          <p className="shrink-0">Class of {classYear}</p>
          <p className="min-w-0 truncate" title={hometown}>{hometown}</p>
        </div>
      </div>
    </motion.div>
  );
}
