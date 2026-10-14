import Link from "next/link";

type Wallet = "apple" | "google";

const WALLETS: Record<Wallet, { name: string; icon: string; width: number }> = {
  apple: { name: "Apple Wallet", icon: "/img/wallet/apple-wallet-icon.svg", width: 19 },
  google: { name: "Google Wallet", icon: "/img/wallet/google-wallet-icon.svg", width: 17 },
};

// The wallet logos and the line that names them. `wallets` is the phone's wallet, or both on a computer.
export function CardButtonContent({ wallets, height = 14 }: { wallets: Wallet[]; height?: number }) {
  const names = wallets.map((w) => WALLETS[w].name).join(" or ");
  return (
    <>
      <span className="mp-wallet-icons" aria-hidden="true">
        {wallets.map((w) => (
          // eslint-disable-next-line @next/next/no-img-element -- fixed-size brand artwork
          <img key={w} src={WALLETS[w].icon} alt="" height={height} width={Math.round((WALLETS[w].width * height) / 14)} />
        ))}
      </span>
      Already a member? Add to {names}
    </>
  );
}

// Members open their card from an emailed link, so it works on any phone.
export default function CardButton({ wallets }: { wallets: Wallet[] }) {
  return <Link className="m-btn is-outline is-small mp-card-button" href="/join/pass"><CardButtonContent wallets={wallets} /></Link>;
}
