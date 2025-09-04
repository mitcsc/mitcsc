"use client";

import { motion } from "framer-motion";
import Image from "next/image";

interface ExecCardProps {
  name: string;
  position: string;
  classYear: string;
  hometown: string;
  image: string;
  rotation?: number;
  className?: string;
  variants?: any;
}

export default function ExecCard({
  name,
  position,
  classYear,
  hometown,
  image,
  rotation = 0,
  className = "",
  variants,
}: ExecCardProps) {
  return (
    <motion.div
      className={`relative bg-white p-3 pb-6 group drop-shadow-lg transition-transform duration-300 hover:scale-105 ${className}`}
      variants={variants}
      style={{ rotate: rotation }}
      whileHover={{ scale: 1.01 }}
    >
      <div className="w-40 h-40 sm:w-48 sm:h-48 md:w-56 md:h-56 overflow-hidden relative bg-black mb-3">
        <Image
          src={`/img/exec/current/${image}`}
          alt={`${name} - ${position}`}
          width={256}
          height={256}
          quality={75}
          sizes="(max-width: 640px) 160px, (max-width: 768px) 192px, 224px"
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <img
          src={`/img/logo/panda.png`}
          alt={`MIT CSC`}
          draggable={false}
          className="w-20 rotate-45 h-auto group-hover:scale-110 group-hover:translate-x-1 group-hover:-translate-y-1 drop-shadow-lg aspect-square absolute -bottom-6 -left-6 ease-out duration-300 object-cover"
        />
      </div>
      <div className="flex flex-col gap-8 w-full">
        <div className="text-center font-bold">
          <h3 className="text-3xl text-black leading-tightest tracking-wide">
            {name}
          </h3>
          <p className="text-xl text-primary leading-tightest tracking-wide">
            {position}
          </p>
        </div>
        <div className="flex justify-between">
          <p className="absolute bottom-4 left-4 text-lg text-black leading-tight tracking-wide">
            Class of {classYear}
          </p>
          <p className="absolute bottom-4 right-4 text-lg text-black leading-tight tracking-wide">
            {hometown}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
