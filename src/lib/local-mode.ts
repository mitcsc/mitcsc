// `npm run dev:local` sets CSC_LOCAL_MODE. The site then uses a private database on this computer,
// with Google, Wallet cards, and emails turned off.
export function localMode() {
  return process.env.NODE_ENV === "development" && process.env.CSC_LOCAL_MODE === "1";
}
