import type { ReactNode } from "react";

/** The closing call to action on marketing pages: a centred frame with a heading, a line and buttons. */
export function CtaPanel({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <section className="py-20 md:py-28">
      <div className="container-site">
        <div className="frame">
          <div className="frame-inner flex flex-col items-center px-6 py-12 text-center md:py-16">
            <h2 className="mb-4 max-w-2xl text-[32px] leading-[1.15] md:text-[44px]">{title}</h2>
            <p className="mb-8 max-w-xl text-lg text-default-600">{body}</p>
            <div className="flex flex-wrap justify-center gap-4">{children}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
