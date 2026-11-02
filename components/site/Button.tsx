import { cn } from "@/lib/utils";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "white" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-deep",
  white: "bg-white text-primary border border-default-200",
  ghost: "text-default-950",
};

const BASE =
  "group inline-flex items-center justify-center gap-3 rounded-xl font-medium transition-colors disabled:opacity-60 disabled:pointer-events-none";

const SIZES = {
  md: "py-3.5 px-7 text-[15px]",
  sm: "py-2.5 px-5 text-sm",
};

/** The template's label roll: two stacked copies, the second slides up on hover. */
function Roll({ children }: { children: ReactNode }) {
  return (
    <span className="roll">
      <span>{children}</span>
      <span aria-hidden="true">{children}</span>
    </span>
  );
}

type Common = {
  variant?: Variant;
  size?: keyof typeof SIZES;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function ButtonLink({
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
  ...props
}: Common & Omit<ComponentProps<typeof Link>, "className" | "children">) {
  return (
    <Link className={cn(BASE, SIZES[size], VARIANTS[variant], className)} {...props}>
      <Roll>{children}</Roll>
      {icon}
    </Link>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
  ...props
}: Common & Omit<ComponentProps<"button">, "className" | "children">) {
  return (
    <button className={cn(BASE, SIZES[size], VARIANTS[variant], className)} {...props}>
      <Roll>{children}</Roll>
      {icon}
    </button>
  );
}

/** A button-styled plain link, for downloads and other sites that next/link shouldn't route. */
export function ButtonAnchor({
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
  ...props
}: Common & Omit<ComponentProps<"a">, "className" | "children">) {
  return (
    <a className={cn(BASE, SIZES[size], VARIANTS[variant], className)} {...props}>
      <Roll>{children}</Roll>
      {icon}
    </a>
  );
}

/** A white button seated in the template's frosted ring (hero CTAs). */
export function FrostedButtonLink(props: Omit<Parameters<typeof ButtonLink>[0], "variant">) {
  return (
    <span className="inline-flex rounded-2xl border border-white/30 bg-white/20 p-1 backdrop-blur-sm">
      <ButtonLink variant="white" {...props} className={cn("border-0", props.className)} />
    </span>
  );
}
