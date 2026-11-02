import { OG_CARDS } from "@/lib/og-cards";
import { OG_CONTENT_TYPE, OG_SIZE, ogImageFor } from "@/lib/og";

export const alt = OG_CARDS.development.title;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImageFor("development");
}
