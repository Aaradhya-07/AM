"use client";

import { useEffect, useRef } from "react";

const starColors = [
  "#ffffff",
  "#ffffaa",
  "#aaaaff",
  "#ffaaaa",
  "#aaffaa",
  "#ffaaff",
  "#aaffff",
] as const;

const pixelSize = 5;
const shootingStarPixelSize = 2;
const frameInterval = 1000 / 16;
const starDensity = 0.00004;
const refreshInterval = 5000;
const shootingStarDelay = () => 2000 + Math.random() * 4000;

type Star = {
  x: number;
  y: number;
  color: string;
  opacity: number;
  period: number;
  phase: number;
};

type ShootingStar = {
  x: number;
  y: number;
  angle: number;
  speed: number;
  trail: { x: number; y: number; opacity: number }[];
};

function createStar(width: number, height: number): Star {
  return {
    x: Math.floor((Math.random() * width) / pixelSize) * pixelSize,
    y: Math.floor((Math.random() * height) / pixelSize) * pixelSize,
    color: starColors[Math.floor(Math.random() * starColors.length)] ?? "#fff",
    opacity: 0.5 + Math.random() * 0.5,
    period: Math.random() < 0.7 ? 2000 + Math.random() * 2000 : 0,
    phase: Math.random(),
  };
}

function drawShootingStar(
  context: CanvasRenderingContext2D,
  star: ShootingStar,
) {
  context.fillStyle = "#b4f2ff";
  for (const point of star.trail) {
    context.globalAlpha = point.opacity;
    context.fillRect(
      Math.round(point.x),
      Math.round(point.y),
      shootingStarPixelSize,
      shootingStarPixelSize,
    );
  }

  context.save();
  context.translate(Math.round(star.x), Math.round(star.y));
  context.rotate(star.angle);
  context.fillStyle = "#fff";
  context.globalAlpha = 1;
  context.fillRect(
    shootingStarPixelSize,
    0,
    3 * shootingStarPixelSize,
    shootingStarPixelSize,
  );
  context.fillRect(
    0,
    shootingStarPixelSize,
    3 * shootingStarPixelSize,
    shootingStarPixelSize,
  );
  context.restore();
}

export function BackgroundPixelStars() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let stars: Star[] = [];
    let shootingStars: ShootingStar[] = [];
    let frame: number | undefined;
    let lastFrame = 0;
    let elapsed = 0;
    let nextRefresh = refreshInterval;
    let nextShootingStar = 0;

    function draw(timestamp: number) {
      if (!canvas || !context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      for (const star of stars) {
        const dim =
          star.period > 0 && (timestamp / star.period + star.phase) % 1 >= 0.5;
        context.globalAlpha = star.opacity * (dim ? 0.3 : 1);
        context.fillStyle = star.color;
        context.fillRect(star.x, star.y, pixelSize, pixelSize);
      }
      for (const star of shootingStars) drawShootingStar(context, star);
      context.globalAlpha = 1;
    }

    function resize() {
      if (!canvas) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width === width && canvas.height === height && stars.length)
        return;
      canvas.width = width;
      canvas.height = height;
      stars = Array.from(
        { length: Math.floor(width * height * starDensity) },
        () => createStar(width, height),
      );
      shootingStars = [];
      draw(elapsed);
    }

    function animate(timestamp: number) {
      if (!canvas) return;
      const delta = timestamp - lastFrame;
      if (delta >= frameInterval) {
        const step =
          frameInterval * Math.min(2, Math.floor(delta / frameInterval));
        lastFrame = timestamp - (delta % frameInterval);
        elapsed += step;

        if (elapsed >= nextRefresh) {
          const count = Math.floor(stars.length * 0.15);
          for (let index = 0; index < count; index++) {
            const slot = Math.floor(Math.random() * stars.length);
            stars[slot] = createStar(canvas.width, canvas.height);
          }
          nextRefresh = elapsed + refreshInterval;
        }

        if (elapsed >= nextShootingStar) {
          shootingStars.push({
            x: Math.random() * canvas.width,
            y: 0,
            angle: Math.PI / 4 + Math.random() * (Math.PI / 2),
            speed: 8 + Math.random() * 5,
            trail: [],
          });
          nextShootingStar = elapsed + shootingStarDelay();
        }

        for (const star of shootingStars) {
          star.trail.push({ x: star.x, y: star.y, opacity: 1 });
          for (const point of star.trail) point.opacity -= 0.1;
          star.trail = star.trail.filter(({ opacity }) => opacity > 0);
          const distance = star.speed * (step / frameInterval);
          star.x += distance * Math.cos(star.angle);
          star.y += distance * Math.sin(star.angle);
        }
        shootingStars = shootingStars.filter(
          ({ x, y }) =>
            x >= -30 && x <= canvas.width + 30 && y <= canvas.height + 30,
        );
        draw(elapsed);
      }
      frame = requestAnimationFrame(animate);
    }

    function updateMotion() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      if (reducedMotion.matches || document.hidden) {
        shootingStars = [];
        draw(elapsed);
        return;
      }
      lastFrame = performance.now();
      frame = requestAnimationFrame(animate);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    updateMotion();
    reducedMotion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateMotion);

    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
      reducedMotion.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateMotion);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
    />
  );
}
