import Image from "next/image";
import type { ReactNode } from "react";

export default function LoadingLabel({children}: {children: ReactNode}) {
  return <span className="voting-loading-label"><Image src="/img/logo/panda.png" alt="" aria-hidden="true" width={32} height={32}/><span>{children}</span></span>;
}
