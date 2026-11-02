import type { ReactNode } from "react";
import SiteFooter from "./SiteFooter";
import SiteNavbar from "./SiteNavbar";

/** Marketing-page chrome: floating navbar, white page, sky footer. */
export default function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <SiteNavbar />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
