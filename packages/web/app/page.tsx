import { Closing } from "./components/closing";
import { SystemFlow } from "./components/cinematic-workflow";
import { Hero } from "./components/hero";
import { Principles } from "./components/principles";
import { InteractionLayer } from "./components/interaction-layer";
import { RevealController } from "./components/reveal-controller";
import { SiteFooter } from "./components/site-footer";
import { SiteHeader } from "./components/site-header";
import { SpecPlate } from "./components/spec-plate";

export default function HomePage() {
  return (
    <>
      <a className="am-skip" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        <Hero />
        <SpecPlate />
        <SystemFlow />
        <Principles />
        <Closing />
      </main>
      <SiteFooter />
      <RevealController />
      <InteractionLayer />
    </>
  );
}
