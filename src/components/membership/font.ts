import localFont from "next/font/local";

// Next preloads these files and sizes the Arial fallback to match, so text doesn't widen when the font arrives.
export const instrumentSans = localFont({
  src: [
    { path: "../../../public/font/instrument-sans/400.ttf", weight: "400" },
    { path: "../../../public/font/instrument-sans/500.ttf", weight: "500" },
    { path: "../../../public/font/instrument-sans/600.ttf", weight: "600" },
  ],
  variable: "--font-instrument-sans",
});
