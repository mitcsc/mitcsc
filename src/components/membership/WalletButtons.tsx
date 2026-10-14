"use client";

import { useEffect, useState } from "react";

export interface WalletInfo {
  buttons: ("apple" | "google")[];
  // Set when a Wallet button sent the member back here with a problem.
  problem: string | null;
}

const BADGES = {
  apple: { href: "/join/wallet/apple", src: "/img/wallet/add-to-apple-wallet.svg", alt: "Add to Apple Wallet" },
  google: { href: "/join/wallet/google", src: "/img/wallet/add-to-google-wallet.svg", alt: "Add to Google Wallet" },
};

// Plain links, because iPhones add a pass only when the browser opens the .pkpass file itself.
// The first tap makes the card, which takes a few seconds, so the buttons dim until the page moves on.
// `link` is the one-time code from a card email; the first tap uses it up and remembers this browser.
export default function WalletButtons({ wallet, link }: { wallet: WalletInfo; link?: string }) {
  const [busy, setBusy] = useState(false);
  // The problem came in the URL. Keep showing it, but drop it from the address so a reload starts clean.
  useEffect(() => {
    if (wallet.problem) window.history.replaceState(null, "", window.location.pathname);
  }, [wallet.problem]);
  useEffect(() => {
    if (!busy) return;
    // A .pkpass download doesn't leave the page, so un-dim after a while or when the person comes back.
    const reset = () => setBusy(false);
    const timer = window.setTimeout(reset, 8000);
    window.addEventListener("pageshow", reset);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pageshow", reset);
    };
  }, [busy]);

  return (
    <>
      <div className={`mp-wallet${busy ? " is-busy" : ""}`} aria-busy={busy}>
        {wallet.buttons.map((platform) => {
          const badge = BADGES[platform];
          return (
            <a key={platform} href={link ? `${badge.href}?link=${encodeURIComponent(link)}` : badge.href} onClick={() => setBusy(true)}>
              {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size brand artwork */}
              <img src={badge.src} alt={badge.alt} height={48} />
            </a>
          );
        })}
      </div>
      {(busy || wallet.problem) && (
        <p className={busy ? "mp-wallet-note" : "m-error"} role="status">{busy ? "Making your card…" : wallet.problem}</p>
      )}
    </>
  );
}
