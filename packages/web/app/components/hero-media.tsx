"use client";

import { useEffect, useRef } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * The hero clip. The markup is rendered on the server without
 * `autoplay`, so the first thing every visitor sees is the poster frame.
 * Playback is started on the client only when reduced motion is not
 * requested, which means reduced-motion visitors keep the still image and
 * never download the movie body.
 */
export function HeroMedia() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const query = window.matchMedia(REDUCED_MOTION);

    const sync = () => {
      if (query.matches) {
        video.pause();
        video.currentTime = 0;
        return;
      }
      if (document.hidden || !video.paused) return;
      video.muted = true;
      void video.play().catch(() => {
        /* Autoplay refused; the poster frame remains. */
      });
    };

    sync();
    query.addEventListener("change", sync);
    // Browsers may decline to start playback while the tab is hidden or the
    // media is not buffered yet, so retry on the events that clear both.
    document.addEventListener("visibilitychange", sync);
    video.addEventListener("canplay", sync);

    return () => {
      query.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      video.removeEventListener("canplay", sync);
    };
  }, []);

  return (
    <div className="am-hero-media order-2 lg:order-none">
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="metadata"
        poster="/hero/anvilmark-hero-hit-only-poster.webp"
        aria-hidden="true"
        tabIndex={-1}
      >
        <source src="/hero/anvilmark-hero-hit-only.mp4" type="video/mp4" />
      </video>
    </div>
  );
}
