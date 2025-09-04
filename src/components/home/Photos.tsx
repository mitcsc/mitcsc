"use client";

import { useMemo, useState, useEffect, memo, useCallback } from "react";
import { motion } from "framer-motion";
import { getRandomImages } from "@/lib/client-utils";
import Image from "next/image";

interface PhotosProps {
  images: string[];
}

const positions = [
  { x: 1, y: 6 },
  { x: 2, y: 55 },
  { x: 12, y: 12 },
  { x: 38.5, y: 10 },
  { x: 18.5, y: 52 },
  { x: 48, y: 49 },
  { x: 62.5, y: 12 },
  { x: 73, y: 50 },
  { x: 25, y: 10 },
  { x: 85, y: 54 },
  { x: 75, y: 5 },
  { x: 50, y: 6 },
  { x: 31, y: 52 },
  { x: 60, y: 53 },
  { x: 85, y: 5 },
];

function Photos({ images }: PhotosProps) {
  const [isClient, setIsClient] = useState(false);
  const [imageRotations, setImageRotations] = useState<number[]>([]);
  const [currentBreakpoint, setCurrentBreakpoint] = useState<string>("lg");
  const [selectedImages, setSelectedImages] = useState<string[]>([]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Helper function to get breakpoint from width
  const getBreakpoint = useCallback((width: number) => {
    if (width < 640) return "sm";
    if (width < 768) return "md";
    if (width < 1024) return "lg";
    if (width < 1280) return "xl";
    return "2xl";
  }, []);

  // Only rerender when breakpoint changes
  useEffect(() => {
    if (!isClient) return;

    const handleResize = () => {
      const newBreakpoint = getBreakpoint(window.innerWidth);
      if (newBreakpoint !== currentBreakpoint) {
        setCurrentBreakpoint(newBreakpoint);
      }
    };

    // Set initial breakpoint
    setCurrentBreakpoint(getBreakpoint(window.innerWidth));

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isClient, currentBreakpoint, getBreakpoint]);

  // Update selected images only when we need MORE images
  useEffect(() => {
    if (!isClient) return;

    const requiredPhotos =
      currentBreakpoint === "sm"
        ? 8
        : currentBreakpoint === "md"
        ? 10
        : currentBreakpoint === "lg"
        ? 12
        : currentBreakpoint === "xl"
        ? 14
        : 15;

    // Only fetch new images if we need more than we currently have
    if (requiredPhotos > selectedImages.length) {
      const newImages = getRandomImages(images, requiredPhotos);
      setSelectedImages(newImages);
    }
  }, [currentBreakpoint, selectedImages.length, isClient, images]);

  // Generate random rotations once when selectedImages change
  useEffect(() => {
    if (isClient && selectedImages.length > 0) {
      const rotations = selectedImages.map(() => {
        // Generate truly random rotation between -20 and +20 degrees
        return (Math.random() - 0.5) * 40;
      });
      setImageRotations(rotations);
    }
  }, [selectedImages, isClient]);

  // Calculate how many images to actually display
  const imagesToDisplay = useMemo(() => {
    if (!isClient) return [];

    const requiredPhotos = currentBreakpoint === "sm" ? 8 : 15;

    return selectedImages.slice(0, requiredPhotos);
  }, [selectedImages, currentBreakpoint, isClient]);

  return (
    <section className="relative w-full h-full flex-1 overflow-hidden max-h-[65vh] sm:max-h-none">
      <div className="relative w-full h-full">
        {imagesToDisplay.map((image, index) => (
          <motion.div
            key={image}
            style={{
              top: `${positions[index].y}%`,
              left: `${positions[index].x}%`,
              transformOrigin: "center center",
            }}
            className="absolute bg-white p-2 pb-8 drop-shadow-lg transition-transform duration-300 hover:scale-105"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1, rotate: imageRotations[index] }}
            transition={{
              duration: 0.1,
              ease: "linear",
            }}
          >
            <div className="w-28 h-28 sm:w-32 sm:h-32 md:w-48 md:h-48 lg:w-52 lg:h-52 xl:w-64 xl:h-64 overflow-hidden relative bg-gray-200">
              <Image
                src={`/img/event/${image}`}
                alt={`MIT CSC ${image}`}
                width={256}
                height={256}
                quality={50}
                sizes="33vw"
                className="w-full h-full object-cover"
                loading="eager"
              />
            </div>
            <span className="text-neutral-700 text-2xl font-primary font-bold">
              {image}
            </span>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

export default memo(Photos);
