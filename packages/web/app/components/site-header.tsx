"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const links = [
  { href: "/", label: "The product" },
  { href: "/models", label: "Model research" },
  { href: "/workspace", label: "Your records" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);
  return (
    <header className="alpha alpha-header">
      <div className="alpha-shell alpha-header-inner">
        <Link className="alpha-brand" href="/" aria-label="Anvilmark home">
          <Image
            src="/brand/logo-mark-monochrome-transparent.png"
            width={42}
            height={42}
            alt=""
          />
          <span>
            ANVILMARK<span className="alpha-version">ALPHA / 01</span>
          </span>
        </Link>
        <nav className="alpha-desktop-nav" aria-label="Primary">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <Link
          className="alpha-button alpha-button-small alpha-header-start"
          href="/start"
        >
          Start locally <span aria-hidden="true">↗</span>
        </Link>
        <button
          ref={toggle}
          className="alpha-menu-toggle"
          aria-expanded={open}
          aria-controls="alpha-mobile-nav"
          onClick={() => setOpen(!open)}
        >
          {open ? "Close −" : "Menu +"}
        </button>
      </div>
      <nav
        id="alpha-mobile-nav"
        aria-label="Primary, mobile"
        className="alpha-mobile-nav alpha-shell"
        hidden={!open}
      >
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setOpen(false)}
            aria-current={pathname === link.href ? "page" : undefined}
          >
            {link.label}
            <span aria-hidden="true">↗</span>
          </Link>
        ))}
        <Link href="/start" onClick={() => setOpen(false)}>
          Start locally <span aria-hidden="true">↗</span>
        </Link>
      </nav>
    </header>
  );
}
