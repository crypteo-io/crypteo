import SolutionPage from "@/components/site/SolutionPage";
import { solutionLink } from "@/lib/content/solution-links";
import { pageMetadata } from "@/lib/seo";
import type { Metadata } from "next";

const { title, description, path } = solutionLink("openSource");

export const metadata: Metadata = pageMetadata({ title, description, path });

// Rendered per request: the page prints the billed fee schedule.
export const dynamic = "force-dynamic";

export default function Page() {
  return <SolutionPage id="openSource" />;
}
