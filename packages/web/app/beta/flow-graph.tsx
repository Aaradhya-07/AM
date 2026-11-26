"use client";

import type { GeneratedPlan } from "../../lib/planner";
import styles from "./beta.module.css";

export function FlowGraph({ flows }: { flows: GeneratedPlan["flows"] }) {
  if (!flows.length) return null;

  return (
    <div
      className={styles.flowGraph}
      role="region"
      aria-label="Data flows and trust boundaries diagram"
    >
      <div className={styles.flowGraphHeader}>
        <h4>Data flows &amp; trust boundaries</h4>
        <span className={styles.flowGraphCount}>
          {flows.length} {flows.length === 1 ? "flow" : "flows"}
        </span>
      </div>

      <ol className={styles.flowDiagramList}>
        {flows.map((flow, index) => (
          <li
            className={styles.flowEdgeCard}
            key={`${flow.from}-${flow.to}-${index}`}
          >
            <div className={`${styles.flowNode} ${styles.flowNodeSource}`}>
              <span className={styles.flowNodeKind}>
                <i aria-hidden="true" /> Source
              </span>
              <strong>{flow.from}</strong>
            </div>

            <div className={styles.flowConnector}>
              <span className={styles.flowDataLabel}>{flow.data}</span>

              <svg
                className={styles.flowArrowHorizontal}
                viewBox="0 0 180 24"
                fill="none"
                aria-hidden="true"
              >
                <line
                  x1="4"
                  y1="12"
                  x2="164"
                  y2="12"
                  stroke="#554b68"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
                <circle
                  cx="88"
                  cy="12"
                  r="4"
                  fill="#181621"
                  stroke="#eac6a6"
                  strokeWidth="1.5"
                />
                <path
                  d="M158 6.5L168 12L158 17.5"
                  stroke="#eac6a6"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>

              <svg
                className={styles.flowArrowVertical}
                viewBox="0 0 24 38"
                fill="none"
                aria-hidden="true"
              >
                <line
                  x1="12"
                  y1="3"
                  x2="12"
                  y2="30"
                  stroke="#554b68"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                />
                <circle
                  cx="12"
                  cy="15"
                  r="3.5"
                  fill="#181621"
                  stroke="#eac6a6"
                  strokeWidth="1.4"
                />
                <path
                  d="M7 25L12 33L17 25"
                  stroke="#eac6a6"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>

              <span className={styles.flowBoundaryBadge}>
                <svg
                  aria-hidden="true"
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 1.8 13 3.7v3.8c0 3.2-2.1 5.6-5 6.7-2.9-1.1-5-3.5-5-6.7V3.7L8 1.8Z" />
                </svg>
                <span>{flow.boundary}</span>
              </span>
            </div>

            <div className={`${styles.flowNode} ${styles.flowNodeTarget}`}>
              <span className={styles.flowNodeKind}>
                <i aria-hidden="true" /> Target
              </span>
              <strong>{flow.to}</strong>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
