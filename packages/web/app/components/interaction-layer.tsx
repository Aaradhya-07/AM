"use client";

import { useEffect } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

/** How far a magnetic control may lean toward the pointer, in pixels. */
const PULL = 7;

/**
 * Pointer and scroll driven motion, attached once for the whole page so no
 * component has to become a client component just to move.
 *
 * Both effects are opt-in through data attributes and both stand down under
 * reduced motion. The magnetic pull additionally requires a fine pointer, so
 * touch devices never get a control that has drifted away from the finger.
 */
export function InteractionLayer() {
  useEffect(() => {
    const reduced = window.matchMedia(REDUCED_MOTION);
    const fine = window.matchMedia(FINE_POINTER);
    const cleanups: Array<() => void> = [];

    const attachMagnetic = () => {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>("[data-magnetic]"),
      );

      for (const node of nodes) {
        const onMove = (event: PointerEvent) => {
          const rect = node.getBoundingClientRect();
          const dx =
            (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
          const dy =
            (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
          node.dataset.magneticActive = "true";
          node.style.transform = `translate(${(dx * PULL).toFixed(2)}px, ${(dy * PULL * 0.55).toFixed(2)}px)`;
        };

        const onLeave = () => {
          node.dataset.magneticActive = "false";
          node.style.transform = "";
        };

        node.addEventListener("pointermove", onMove);
        node.addEventListener("pointerleave", onLeave);
        node.addEventListener("blur", onLeave);
        cleanups.push(() => {
          node.removeEventListener("pointermove", onMove);
          node.removeEventListener("pointerleave", onLeave);
          node.removeEventListener("blur", onLeave);
          onLeave();
        });
      }
    };

    const attachParallax = () => {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>("[data-parallax]"),
      );
      if (nodes.length === 0) return;

      let raf = 0;
      const update = () => {
        raf = 0;
        const viewport = window.innerHeight;
        for (const node of nodes) {
          const rect = node.getBoundingClientRect();
          if (rect.bottom < -viewport || rect.top > viewport * 2) continue;
          const depth = Number(node.dataset.parallax) || 0.06;
          // Centre of the element relative to the centre of the viewport.
          const offset = rect.top + rect.height / 2 - viewport / 2;
          node.style.transform = `translate3d(0, ${(-offset * depth).toFixed(1)}px, 0)`;
        }
      };

      const request = () => {
        if (!raf) raf = window.requestAnimationFrame(update);
      };

      window.addEventListener("scroll", request, { passive: true });
      window.addEventListener("resize", request);
      request();

      cleanups.push(() => {
        if (raf) window.cancelAnimationFrame(raf);
        window.removeEventListener("scroll", request);
        window.removeEventListener("resize", request);
        for (const node of nodes) node.style.transform = "";
      });
    };

    const sync = () => {
      while (cleanups.length) cleanups.pop()?.();
      if (reduced.matches) return;
      if (fine.matches) attachMagnetic();
      attachParallax();
    };

    sync();
    reduced.addEventListener("change", sync);
    fine.addEventListener("change", sync);

    return () => {
      reduced.removeEventListener("change", sync);
      fine.removeEventListener("change", sync);
      while (cleanups.length) cleanups.pop()?.();
    };
  }, []);

  return null;
}
