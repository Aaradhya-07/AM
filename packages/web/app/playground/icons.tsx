// Inert inline icons. Color always accompanies a text label elsewhere.
import type { SVGProps } from "react";

import type { Standing } from "./types";

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M3 8.5l3 3 7-7.5" />
    </svg>
  );
}

export function CrossIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function QuestionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6a2 2 0 1 1 3 1.7c-.7.5-1 .9-1 1.8" />
      <circle cx="8" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MinusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8h8" />
    </svg>
  );
}

export function ArrowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M3 8h9M9 5l3 3-3 3" />
    </svg>
  );
}

export function StandingIcon({
  standing,
  ...props
}: { standing: Standing } & SVGProps<SVGSVGElement>) {
  switch (standing) {
    case "pass":
      return <CheckIcon {...props} />;
    case "fail":
      return <CrossIcon {...props} />;
    case "not_applicable":
      return <MinusIcon {...props} />;
    default:
      return <QuestionIcon {...props} />;
  }
}
