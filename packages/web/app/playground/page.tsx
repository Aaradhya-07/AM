import type { Metadata } from "next";
import { RetiredSurface } from "../components/retired-surface";
export const metadata: Metadata = {
  title: "A new chapter",
  robots: { index: false, follow: true },
};
export default function Page() {
  return <RetiredSurface />;
}
