import { LandingFooter } from "./landing/LandingFooter";
import { s } from "./landing/styles";
import { fontVars } from "./landing/fonts";

/** The app's footer: the same light directory on every page, the landing page included. */
export function Footer() {
  return (
    <div className={`${s.root} ${fontVars}`}>
      <LandingFooter />
    </div>
  );
}
