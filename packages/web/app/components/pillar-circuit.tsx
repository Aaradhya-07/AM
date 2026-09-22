/**
 * Anvil Pillar Circuit: The brand mark rendered as an architectural
 * circuit core with radiating traces and pulsing terminal nodes.
 * Adapted with gold and sand circuit styling for the dark theme.
 */
export function PillarCircuit({
  className = "",
  glow = true,
}: {
  className?: string;
  glow?: boolean;
}) {
  const nodes = [
    [60, 70],
    [60, 150],
    [60, 250],
    [140, 40],
    [140, 300],
    [520, 70],
    [520, 150],
    [520, 250],
    [440, 40],
    [440, 300],
  ];

  const traces = [
    "M290 170 H140 V70 H60",
    "M290 170 H140 V150 H60",
    "M290 200 H120 V250 H60",
    "M290 140 H180 V40 H140",
    "M290 230 H180 V300 H140",
    "M310 170 H460 V70 H520",
    "M310 170 H460 V150 H520",
    "M310 200 H480 V250 H520",
    "M310 140 H420 V40 H440",
    "M310 230 H420 V300 H440",
  ];

  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      {glow ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-4 rounded-full bg-gold/10 blur-3xl"
        />
      ) : null}

      <svg
        viewBox="0 0 580 340"
        className="relative h-auto w-full max-w-[36rem]"
        role="presentation"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="traceGradDark" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#DCC6AC" stopOpacity="0.2" />
            <stop offset="50%" stopColor="#D08D2E" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#DCC6AC" stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* Outer traces with traveling signal dash */}
        {traces.map((d, i) => (
          <g key={d}>
            {/* Base dim trace */}
            <path
              d={d}
              fill="none"
              stroke="#DCC6AC"
              strokeOpacity="0.2"
              strokeWidth="1.2"
            />
            {/* Animated traveling signal */}
            <path
              d={d}
              fill="none"
              stroke="#D08D2E"
              strokeOpacity="0.75"
              strokeWidth="1.6"
              strokeDasharray="60 160"
              className="motion-safe:animate-dash"
              style={{
                animationDelay: `${i * 0.18}s`,
                animationDuration: "3.5s",
                animationIterationCount: "infinite",
              }}
            />
          </g>
        ))}

        {/* Central Anvil Pillar core */}
        <g
          stroke="#D08D2E"
          strokeWidth="2.4"
          strokeLinecap="round"
          className="filter drop-shadow-[0_0_8px_rgba(208,141,46,0.35)]"
        >
          {/* Capital (Top) */}
          <line x1="278" y1="120" x2="322" y2="120" />
          <line x1="284" y1="132" x2="316" y2="132" />
          {/* Vertical flutes */}
          <line x1="288" y1="145" x2="288" y2="225" />
          <line x1="300" y1="145" x2="300" y2="225" strokeWidth="2.8" />
          <line x1="312" y1="145" x2="312" y2="225" />
          {/* Plinth (Base) */}
          <line x1="284" y1="238" x2="316" y2="238" />
          <line x1="278" y1="250" x2="322" y2="250" />
        </g>

        {/* Terminal nodes with pulsing radiance */}
        {nodes.map(([cx, cy], i) => (
          <g key={`${cx}-${cy}`}>
            <circle
              cx={cx}
              cy={cy}
              r="7"
              fill="#111519"
              stroke="#D08D2E"
              strokeWidth="1.8"
              className="motion-safe:animate-pulseNode"
              style={{
                animationDelay: `${i * 0.28}s`,
                transformOrigin: `${cx}px ${cy}px`,
              }}
            />
            <circle cx={cx} cy={cy} r="2.5" fill="#D08D2E" opacity="0.9" />
          </g>
        ))}
      </svg>
    </div>
  );
}
