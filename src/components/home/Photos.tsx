import type { CSSProperties } from "react";
import { getEventImages, pickRandom } from "@/lib/images";

/**
 * Polaroid slots rendered into the hero. The CSS grid in globals.css
 * (`.hero-photos`) decides how many are visible per breakpoint and viewport
 * height: phones show 9, tablets 9 or 12, desktops 10 or 15.
 */
const PHOTO_COUNT = 15;

/** Slots that are hidden on at least one breakpoint load lazily so a phone never downloads them. */
const ALWAYS_VISIBLE = 9;

/**
 * The first few slots are likely LCP candidates on every breakpoint. React
 * already emits a preload for every eager image during SSR, so the explicit
 * fetch priority is what moves these ahead of the rest.
 */
const PRIORITY_COUNT = 4;

const MAX_TILT_DEG = 18;

/**
 * Candidate widths for the srcset. Each must be listed in `images.imageSizes`
 * in next.config.ts, and the quality in `images.qualities`. The largest
 * rendered photo is 256 CSS px, so 512 covers 2x screens.
 */
const WIDTHS = [256, 384, 512];
const QUALITY = 60;

/** Largest rendered photo width per breakpoint. Keep in sync with `--photo-max` in globals.css. */
const SIZES =
  "(min-width: 1536px) 256px, (min-width: 1280px) 224px, (min-width: 1024px) 176px, (min-width: 768px) 192px, (min-width: 640px) 128px, 104px";

interface PhotoSlot {
  file: string;
  /** Horizontal position inside the grid cell, 0..1. */
  jx: number;
  /** Vertical position inside the grid cell, 0..1. */
  jy: number;
  /** Tilt in degrees. */
  tilt: number;
}

function buildSlots(): PhotoSlot[] {
  return pickRandom(getEventImages(), PHOTO_COUNT).map((file) => ({
    file,
    jx: Math.random(),
    jy: Math.random(),
    tilt: (Math.random() * 2 - 1) * MAX_TILT_DEG,
  }));
}

/**
 * URL served by the Next.js image optimizer (Vercel Image Optimization in
 * production). Building it by hand keeps the markup to three candidates
 * instead of the seventeen `next/image` emits, and avoids shipping fifteen
 * client components for static photos.
 */
function optimizedUrl(file: string, width: number): string {
  const src = encodeURIComponent(`/img/event/${file}`);
  return `/_next/image?url=${src}&w=${width}&q=${QUALITY}`;
}

export default function Photos() {
  const slots = buildSlots();

  return (
    <section
      aria-label="Photos from past CSC events"
      className="relative w-full h-full flex-1 flex items-center justify-center overflow-hidden max-h-[min(65vh,800px)] sm:max-h-none"
    >
      <ul className="hero-photos relative w-full h-full max-w-[1920px] list-none m-0 p-0">
        {slots.map((slot, index) => (
          <li
            key={slot.file}
            className="hero-photo"
            style={
              {
                "--i": index,
                "--jx": slot.jx.toFixed(3),
                "--jy": slot.jy.toFixed(3),
                "--tilt": `${slot.tilt.toFixed(1)}deg`,
              } as CSSProperties
            }
          >
            <div className="hero-polaroid bg-white p-2 pb-8">
              <div className="hero-polaroid-frame relative overflow-hidden bg-gray-200">
                {/* eslint-disable-next-line @next/next/no-img-element -- see optimizedUrl */}
                <img
                  src={optimizedUrl(slot.file, WIDTHS[WIDTHS.length - 1])}
                  srcSet={WIDTHS.map((w) => `${optimizedUrl(slot.file, w)} ${w}w`).join(", ")}
                  sizes={SIZES}
                  alt=""
                  width={256}
                  height={256}
                  decoding="async"
                  loading={index < ALWAYS_VISIBLE ? "eager" : "lazy"}
                  fetchPriority={index < PRIORITY_COUNT ? "high" : "auto"}
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="block text-neutral-700 text-2xl font-primary font-bold truncate">
                {slot.file}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
