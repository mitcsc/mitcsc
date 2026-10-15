import type { CSSProperties } from "react";
import PhotoPile from "@/components/home/PhotoPile";
import { homePagePhotos, homePhotoSrc } from "@/lib/home-photos";
import { getEventImages, HERO_PHOTO_WIDTHS as WIDTHS, optimizerUrl, pickRandom } from "@/lib/images";

/**
 * Polaroid slots rendered into the hero. The CSS grid in globals.css
 * (`.hero-photos`) decides how many are visible per breakpoint and viewport
 * height: phones show 9, tablets 12 or 16, desktops 10.
 */
const PHOTO_COUNT = 16;

/** Slots that are hidden on at least one breakpoint load lazily so a phone never downloads them. */
const ALWAYS_VISIBLE = 9;

/**
 * The first few slots are likely LCP candidates on every breakpoint. React
 * already emits a preload for every eager image during SSR, so the explicit
 * fetch priority is what moves these ahead of the rest.
 */
const PRIORITY_COUNT = 4;

const MAX_TILT_DEG = 30;

/** Per-photo size variance so the pile does not look stamped from one mould. */
const MIN_SCALE = 0.8;
const MAX_SCALE = 1.12;

/** Entrance: each polaroid lands on its own schedule. */
const MAX_DELAY_MS = 800;
const MIN_FALL_MS = 600;
const MAX_FALL_MS = 1000;
/** Extra twist while airborne that unwinds on landing, degrees. */
const MAX_SPIN_DEG = 25;
/** Sideways drift while airborne, px. */
const MAX_DRIFT_PX = 30;

/** Largest square photo per breakpoint, in CSS px. Keep in sync with `--photo-max` in globals.css. */
const PHOTO_MAX: [minWidth: number, px: number][] = [[1280, 256], [1024, 208], [768, 192], [640, 136], [0, 120]];

/**
 * The square frame crops a 3:2 photo, so a landscape file must be 1.5x as
 * wide as the frame to fill it without upscaling. Polaroids are also scaled
 * up to MAX_SCALE.
 */
const COVER = 1.5 * MAX_SCALE;

const SIZES = PHOTO_MAX.map(([minWidth, px]) => {
  const width = `${Math.ceil(px * COVER)}px`;
  return minWidth ? `(min-width: ${minWidth}px) ${width}` : width;
}).join(", ");

interface PhotoSlot extends Source {
  /** Horizontal position inside the grid cell, 0..1. */
  jx: number;
  /** Vertical position inside the grid cell, 0..1. */
  jy: number;
  /** Tilt in degrees. */
  tilt: number;
  /** Size multiplier, MIN_SCALE..MAX_SCALE. */
  scale: number;
  /** Stacking order among overlapping neighbours. */
  z: number;
  /** Entrance timing and motion. */
  delayMs: number;
  fallMs: number;
  spin: number;
  driftPx: number;
}

interface Source {
  key: string;
  caption: string;
  src: (width: number) => string;
  /** A tiny copy of the photo as a data URL, shown blurred until the photo loads. */
  placeholder?: string;
}

// Photos turned on in the dashboard, from Drive. While none are on, the photos in public/img/event.
async function photoSources(): Promise<Source[]> {
  const drive = await homePagePhotos().catch(() => []);
  if (drive.length) return drive.map((photo) => ({ key: photo.id, caption: photo.name, src: (width) => homePhotoSrc(photo, width), placeholder: photo.placeholder }));
  return getEventImages().map((file) => ({ key: file, caption: file, src: (width) => optimizerUrl(`/img/event/${file}`, width) }));
}

function buildSlots(sources: Source[]): PhotoSlot[] {
  return pickRandom(sources, PHOTO_COUNT).map((source) => ({
    ...source,
    jx: Math.random(),
    jy: Math.random(),
    tilt: (Math.random() * 2 - 1) * MAX_TILT_DEG,
    scale: MIN_SCALE + Math.random() * (MAX_SCALE - MIN_SCALE),
    z: Math.floor(Math.random() * 10),
    delayMs: Math.round(Math.random() * MAX_DELAY_MS),
    fallMs: Math.round(MIN_FALL_MS + Math.random() * (MAX_FALL_MS - MIN_FALL_MS)),
    spin: (Math.random() * 2 - 1) * MAX_SPIN_DEG,
    driftPx: (Math.random() * 2 - 1) * MAX_DRIFT_PX,
  }));
}

/**
 * The placeholder blurred and cropped to fill the square frame, as a CSS
 * background. The filter sets every pixel fully opaque, so the blur does not
 * fade out at the edges. next/image's placeholder="blur" draws it the same way.
 */
function blurredBackground(placeholder: string) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><filter id='b' color-interpolation-filters='sRGB'><feGaussianBlur stdDeviation='6'/><feComponentTransfer><feFuncA type='discrete' tableValues='1 1'/></feComponentTransfer></filter><image width='100' height='100' preserveAspectRatio='xMidYMid slice' filter='url(#b)' href='${placeholder}'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Marks each photo once it loads, so it fades in over its placeholder (see
 * `.hero-polaroid-frame img` in globals.css). It runs before the photos are in
 * the page, so it sees every load, even one that ends before React starts.
 * PhotoPile does the same after a client-side navigation, where this script
 * does not run.
 */
const MARK_LOADED = `document.addEventListener("load",function(e){var t=e.target;if(t.matches&&t.matches(".hero-polaroid-frame img"))t.setAttribute("data-loaded","")},true)`;

export default async function Photos() {
  const slots = buildSlots(await photoSources());

  return (
    <section
      aria-label="Photos from past CSC events"
      className="relative w-full h-full flex-1 flex items-center justify-center overflow-x-clip max-h-[min(65vh,800px)] sm:max-h-none"
    >
      <script dangerouslySetInnerHTML={{ __html: MARK_LOADED }} />
      <PhotoPile className="hero-photos relative w-full h-full xl:max-w-7xl list-none m-0 p-0">
        {slots.map((slot, index) => (
          <li
            key={slot.key}
            className="hero-photo"
            style={
              {
                "--jx": slot.jx.toFixed(3),
                "--jy": slot.jy.toFixed(3),
                "--tilt": `${slot.tilt.toFixed(1)}deg`,
                "--s": slot.scale.toFixed(3),
                "--z": slot.z,
                "--delay": `${slot.delayMs}ms`,
                "--fall": `${slot.fallMs}ms`,
                "--spin": `${slot.spin.toFixed(1)}deg`,
                "--drift": `${slot.driftPx.toFixed(0)}px`,
              } as CSSProperties
            }
          >
            <div className="hero-polaroid bg-white p-2 pb-8">
              <div
                className="hero-polaroid-frame relative overflow-hidden bg-gray-200 bg-cover"
                style={slot.placeholder ? { backgroundImage: blurredBackground(slot.placeholder) } : undefined}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a srcset built by hand has 6 candidates instead of 17, and ships no client component per photo */}
                <img
                  src={slot.src(WIDTHS[WIDTHS.length - 1])}
                  srcSet={WIDTHS.map((w) => `${slot.src(w)} ${w}w`).join(", ")}
                  sizes={SIZES}
                  alt=""
                  width={256}
                  height={256}
                  decoding="async"
                  loading={index < ALWAYS_VISIBLE ? "eager" : "lazy"}
                  fetchPriority={index < PRIORITY_COUNT ? "high" : "auto"}
                  className="w-full h-full object-cover"
                  // MARK_LOADED may add data-loaded before React starts. That is expected, so React should not warn.
                  suppressHydrationWarning
                />
              </div>
              <span className="block text-neutral-700 text-2xl font-primary font-bold truncate">
                {slot.caption}
              </span>
            </div>
          </li>
        ))}
      </PhotoPile>
    </section>
  );
}
