import Image from "next/image";
import Link from "next/link";

// The club logo at the top of the member pages. It links to the home page.
export default function HomeLogo({ small = false }: { small?: boolean }) {
  const size = small ? 44 : 88;
  return (
    <Link href="/" className={`mp-logo-link${small ? " is-small" : ""}`} aria-label="MIT CSC home page">
      <Image src="/img/logo/logo-with-panda.png" alt="" width={size} height={size} className="mp-logo" priority />
    </Link>
  );
}
