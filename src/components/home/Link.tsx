"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { forwardRef } from "react";

export const Link = forwardRef<HTMLAnchorElement, {
  href: string;
  fallback?: React.ElementType;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>>(function Link(
  { href, fallback = "div", onClick, ...props },
  ref
) {
  const pathname = usePathname();

  if (!href || typeof href !== "string") {
    const Tag = fallback;

    return <Tag ref={ref} {...props} href={href} />;
  }

  const isExternal = href.startsWith("http");

  if (isExternal) {
    props.target = "_blank";
    props.rel = "noopener noreferrer";
  }

  const isAnchor =
    href.startsWith("#") ||
    href.startsWith(`${pathname}#`) ||
    (pathname == "" && href.startsWith("#"));
  return (
    <NextLink
      ref={ref}
      onClick={(e) => {
        if (href === pathname) {
          e.preventDefault();
          window.scrollTo(0, 0);
        } else if (isAnchor) {
          e.preventDefault();
          const targetId = href.startsWith("/#") ? href.slice(1) : href;
          const element = document.querySelector(targetId);
          element?.scrollIntoView({ behavior: 'smooth' });
        }
        onClick?.(e);
      }}
      {...props}
      href={href}
    />
  );
});
