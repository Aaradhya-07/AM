/**
 * Board field: the circuit traces from the hero clip continued into the page
 * behind content. Right-angle runs with 45-degree chamfers and circular vias,
 * matching the logo linework. A few traces carry a slow travelling signal so
 * the board reads as live rather than decorative — motion is confined to the
 * dash offset of an existing stroke, so nothing glows, blinks, or drifts.
 */

/* Geometry is authored once and used by both the static and signal layers. */
const TRACES = [
  "M0 88h214l26-26h204l26 26h176",
  "M0 176h130l30 30h188v104h150l26 26h150",
  "M0 300h96v88l28 28h214",
  "M0 452h178l28-28h174v-96h130",
  "M0 604h250l30 30h180v92h206",
  "M0 716h150l26-26h260",
  "M1200 72h-190l-28 28h-198",
  "M1200 210h-120v90l-30 30h-190",
  "M1200 340h-260l-26 26h-140v110",
  "M1200 470h-96v-92l-28-28h-180",
  "M1200 596h-210l-30 30h-176v92",
  "M1200 742h-150l-28-28h-230",
  "M420 800v-120l28-28h150v-96",
  "M760 800v-96l-30-30h-140v-120",
  "M600 0v140l26 26v150",
  "M900 0v96l-28 28h-120v120",
];

/* Vias sit on the terminal point of a trace, as they do on a real board. */
const VIAS: Array<[number, number]> = [
  [646, 88],
  [674, 336],
  [338, 416],
  [510, 328],
  [666, 726],
  [436, 690],
  [784, 100],
  [860, 330],
  [896, 350],
  [784, 718],
  [598, 556],
  [752, 244],
];

const GOLD_VIAS: Array<[number, number]> = [
  [626, 316],
  [774, 476],
];

/* Which traces carry a signal, and how long each takes to travel. */
const SIGNALS: Array<{ index: number; duration: number; delay: number }> = [
  { index: 1, duration: 13, delay: 0 },
  { index: 4, duration: 17, delay: 3.5 },
  { index: 7, duration: 15, delay: 7 },
  { index: 10, duration: 19, delay: 1.5 },
  { index: 14, duration: 11, delay: 5 },
];

export function CircuitField({
  className = "",
  intensity = 1,
  depth = 0.05,
}: {
  className?: string;
  intensity?: number;
  /** Parallax rate against the scroll. 0 pins the field to the page. */
  depth?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      <svg
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
        className="am-parallax absolute inset-x-0 -inset-y-[12%] h-[124%] w-full"
        data-parallax={depth}
        focusable="false"
      >
        <g
          fill="none"
          stroke="#DCC6AC"
          strokeWidth="1"
          opacity={0.1 * intensity}
        >
          {TRACES.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>

        <g
          fill="none"
          stroke="#DCC6AC"
          strokeWidth="1"
          opacity={0.18 * intensity}
        >
          {VIAS.map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="4" />
          ))}
        </g>

        <g
          fill="none"
          stroke="#D08D2E"
          strokeWidth="1"
          opacity={0.5 * intensity}
        >
          {GOLD_VIAS.map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="4" />
          ))}
        </g>

        <g fill="none" strokeWidth="1.5" strokeLinecap="round">
          {SIGNALS.map(({ index, duration, delay }) => (
            <path
              key={index}
              className="am-flow"
              d={TRACES[index]}
              pathLength={1000}
              stroke={index % 2 === 0 ? "#D08D2E" : "#DCC6AC"}
              opacity={0.55 * intensity}
              style={{
                animationDuration: `${duration}s`,
                animationDelay: `${delay}s`,
              }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
