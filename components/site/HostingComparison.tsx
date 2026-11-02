import type { HostingRow } from "@/lib/content/solutions";
import { Cloud, Server } from "lucide-react";

const COLUMNS = [
  { icon: Server, label: "Self-hosted", key: "selfHosted" },
  { icon: Cloud, label: "Hosted", key: "hosted" },
] as const;

/**
 * Self-hosted against hosted Crypteo. Below sm each row's label spans the
 * card and its two answers sit side by side under the column headings.
 */
export function HostingComparison({ rows }: { rows: HostingRow[] }) {
  return (
    <div className="frame">
      <div className="frame-inner overflow-hidden">
        <table className="w-full text-left text-[15px]">
          <caption className="sr-only">Self-hosted and hosted Crypteo compared</caption>
          <thead>
            <tr className="grid grid-cols-2 border-b border-default-100 bg-default-50/70 sm:table-row">
              <td className="hidden sm:table-cell" />
              {COLUMNS.map(({ icon: Icon, label }) => (
                <th key={label} scope="col" className="px-4 py-4 align-bottom md:px-6">
                  <span className="flex items-center gap-2.5 font-heading text-base font-semibold text-default-950 md:text-lg">
                    <span className="icon-tile size-8 shrink-0">
                      <Icon size={16} />
                    </span>
                    {label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="grid grid-cols-2 border-b border-default-100 last:border-b-0 sm:table-row">
                <th
                  scope="row"
                  className="col-span-2 px-4 pt-4 text-sm font-semibold uppercase tracking-wide text-default-500 sm:w-[24%] sm:py-4 sm:align-top md:px-6"
                >
                  {row.label}
                </th>
                {COLUMNS.map(({ key }) => (
                  <td key={key} className="px-4 pt-1.5 pb-4 font-normal text-default-700 sm:py-4 sm:align-top md:px-6">
                    {row[key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
