import { Check, X } from "lucide-react";

/** A titled checklist in the template's frame: ticks for what's true, crosses for what isn't. */
export function ListCard({ title, items, good }: { title: string; items: string[]; good?: boolean }) {
  return (
    <div className="frame">
      <div className="frame-inner h-full p-6 md:p-8">
        <h3 className="mb-6 text-xl md:text-[22px]">{title}</h3>
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item} className="flex gap-3 text-default-700">
              <span
                className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-white ${
                  good ? "bg-sky" : "bg-default-400"
                }`}
              >
                {good ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
