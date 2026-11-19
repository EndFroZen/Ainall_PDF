import type { CSSProperties } from "react";
import logo from "../assets/logo-mark.png";

// The logo used as a CSS mask, so it takes any colour via a bg-* class.
const mask: CSSProperties = {
  maskImage: `url(${logo})`,
  WebkitMaskImage: `url(${logo})`,
  maskSize: "contain",
  WebkitMaskSize: "contain",
  maskRepeat: "no-repeat",
  WebkitMaskRepeat: "no-repeat",
  maskPosition: "center",
  WebkitMaskPosition: "center",
};

/** `className` should include a size and a bg colour, e.g. "h-8 w-8 bg-cream". */
export default function LogoMark({ className = "" }: { className?: string }) {
  return <div aria-hidden className={className} style={mask} />;
}
