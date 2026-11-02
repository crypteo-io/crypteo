import type { LucideIcon } from "lucide-react";

/** A feature in a marketing grid: icon tile, title and a short body in the template's frame. */
export function FeatureCard({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="frame">
      <div className="frame-inner flex h-full flex-col p-6 md:p-8">
        <span className="icon-tile mb-6 size-12">
          <Icon size={22} />
        </span>
        <h3 className="mb-3 text-xl md:text-[22px]">{title}</h3>
        <p className="text-[15px] font-normal text-default-600">{body}</p>
      </div>
    </div>
  );
}
