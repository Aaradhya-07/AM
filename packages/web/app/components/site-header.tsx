"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  LiquidNavbar,
  NimbusIcons,
  type LiquidNavItem,
} from "../../components/ui/liquid-glass-navbar";
import styles from "./site-header.module.css";

const links = [
  { href: "/", label: "Home", icon: NimbusIcons.home, fx: "glow" },
  { href: "/beta", label: "Plan a change", icon: NimbusIcons.drop, fx: "drop" },
  { href: "/models", label: "Models", icon: NimbusIcons.globe, fx: "spin" },
  {
    href: "/start",
    label: "Work locally",
    icon: NimbusIcons.plane,
    fx: "plane",
  },
  {
    href: "/workspace",
    label: "Your records",
    icon: NimbusIcons.user,
    fx: "wave",
  },
] satisfies LiquidNavItem[];

export function SiteHeader({ tone = "light" }: { tone?: "light" | "dark" }) {
  const pathname = usePathname();
  const active = links.findIndex(
    ({ href }) =>
      pathname === href || (href === "/beta" && pathname === "/plan"),
  );
  const dark = tone === "dark";

  return (
    <header className={`${styles.header} ${dark ? styles.dark : styles.light}`}>
      <div className={styles.inner}>
        <Link className={styles.brand} href="/" aria-label="AnvilMark home">
          <Image
            src={
              dark
                ? "/brand/logo-mark-monochrome-reversed-transparent.png"
                : "/brand/logo-mark-monochrome-transparent.png"
            }
            width={29}
            height={29}
            alt=""
          />
          <span>
            AnvilMark <small>Beta</small>
          </span>
        </Link>
        <LiquidNavbar tone={tone} items={links} active={active} />
      </div>
    </header>
  );
}
