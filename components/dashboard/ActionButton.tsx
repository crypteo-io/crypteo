import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "outline" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-white border border-primary hover:bg-primary-deep shadow-aigocy-dark",
  secondary: "bg-white text-default-950 border border-default-200 hover:bg-default-50 hover:border-default-300",
  outline: "bg-white text-default-950 border border-default-200 hover:bg-default-50 hover:border-default-300",
  ghost: "bg-transparent text-default-600 border border-transparent hover:text-default-950 hover:bg-default-100",
};

/** Dashboard action button: navy primary, white outlined secondary. */
export function ActionButton({
  children,
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; variant?: Variant }) {
  return (
    <button
      className={cn(
        "px-6 py-3 rounded-xl font-body font-semibold text-[14px] transition-colors duration-200 flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-sky/40 focus-visible:ring-offset-2",
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
