"use client";

import { useEffect, useRef } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

type ScrollScrubVideoProps = {
  label: string;
  poster: string;
  src: string;
};

/**
 * Keep playback under the reader's control: the containing chapter's viewport
 * position determines the exact frame, and reversing scroll reverses the film.
 */
export function ScrollScrubVideo({
  label,
  poster,
  src,
}: ScrollScrubVideoProps) {
  const frameRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    const video = videoRef.current;
    const chapter = frame?.closest<HTMLElement>("[data-scroll-chapter]");
    if (!frame || !video || !chapter) return;

    const motion = window.matchMedia(REDUCED_MOTION);
    let raf = 0;

    const update = () => {
      raf = 0;

      if (motion.matches) {
        video.pause();
        video.currentTime = 0;
        return;
      }

      const rect = chapter.getBoundingClientRect();
      const viewport = window.innerHeight;
      const start = viewport * 0.85;
      const distance = rect.height + viewport * 0.7;
      const progress = Math.min(1, Math.max(0, (start - rect.top) / distance));

      video.pause();

      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        const lastStableFrame = Math.max(0, video.duration - 1 / 24);
        const target = progress * lastStableFrame;
        if (Math.abs(video.currentTime - target) > 1 / 48) {
          video.currentTime = target;
        }
      }
    };

    const requestUpdate = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };

    /* Scrubbing needs the whole file buffered, but these chapters sit well
       below the fold — fetching them upfront would add megabytes to first
       load. Hold at metadata until the chapter is roughly a screen away. */
    let warmed = false;
    const warm = () => {
      if (warmed) return;
      warmed = true;
      video.preload = "auto";
      video.load();
    };

    const proximity =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                warm();
                proximity?.disconnect();
              }
            },
            { rootMargin: "120% 0px 120% 0px" },
          );

    if (proximity) proximity.observe(chapter);
    else warm();

    video.addEventListener("loadedmetadata", requestUpdate);
    video.addEventListener("loadeddata", requestUpdate);
    motion.addEventListener("change", requestUpdate);
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    requestUpdate();

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      proximity?.disconnect();
      video.removeEventListener("loadedmetadata", requestUpdate);
      video.removeEventListener("loadeddata", requestUpdate);
      motion.removeEventListener("change", requestUpdate);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, []);

  return (
    <figure ref={frameRef} className="am-scroll-media" aria-label={label}>
      <video
        ref={videoRef}
        muted
        playsInline
        preload="metadata"
        poster={poster}
        aria-hidden="true"
        tabIndex={-1}
      >
        <source src={src} type="video/mp4" />
      </video>
    </figure>
  );
}
