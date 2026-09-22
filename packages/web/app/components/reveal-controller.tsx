"use client";

import { useEffect } from "react";

/**
 * Reveals `[data-reveal]` elements as they enter the viewport. Mounted once;
 * it adds no wrappers, so grid and flex layouts are untouched. The hidden
 * start state lives behind `html.js-reveal`, which the inline head script only
 * sets when JavaScript runs and reduced motion is not requested — so no-JS and
 * reduced-motion visitors simply see the finished page.
 */
export function RevealController() {
  useEffect(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );

    if (typeof IntersectionObserver === "undefined") {
      for (const node of nodes) node.dataset.revealed = "true";
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          /* Anchor jumps, restored scroll positions, and fast flicks can carry
             an element from below the fold to above it without it ever
             intersecting. Without the second test those elements would stay
             at opacity 0 permanently, so anything already scrolled past is
             treated as revealed. */
          const scrolledPast =
            entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0);
          if (!entry.isIntersecting && !scrolledPast) continue;
          (entry.target as HTMLElement).dataset.revealed = "true";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );

    for (const node of nodes) observer.observe(node);

    /*
     * Backstop. The worst failure mode here is content that stays invisible
     * forever, and an observer can miss an element for reasons that have
     * nothing to do with whether the reader can see it. getBoundingClientRect
     * reports the unclipped border box, so this check stays correct even when
     * the element's own styles have collapsed it.
     */
    let ticking = 0;
    const sweep = () => {
      ticking = 0;
      const remaining = nodes.filter((node) => !node.dataset.revealed);
      if (remaining.length === 0) {
        window.removeEventListener("scroll", onScroll);
        return;
      }
      for (const node of remaining) {
        const rect = node.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          node.dataset.revealed = "true";
          observer.unobserve(node);
        }
      }
    };

    const onScroll = () => {
      if (!ticking) ticking = window.requestAnimationFrame(sweep);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      observer.disconnect();
      if (ticking) window.cancelAnimationFrame(ticking);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return null;
}
