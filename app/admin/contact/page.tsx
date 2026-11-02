import { ContactInboxClient } from "@/components/dashboard/ContactInboxClient";
import { probeKind } from "@/lib/abuse-signals";
import { adminPageSession } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact messages",
  description: "Contact form submissions (Admin only).",
};

// Newest first; older messages stay in the database.
const SHOWN = 300;

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  await adminPageSession();
  const { id } = await searchParams;

  const [messages, unhandled] = await Promise.all([
    prisma.contactMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: SHOWN,
      select: {
        id: true,
        createdAt: true,
        name: true,
        email: true,
        subject: true,
        message: true,
        handledAt: true,
        handledBy: true,
      },
    }),
    prisma.contactMessage.count({ where: { handledAt: null } }),
  ]);
  const flagged = messages.map((m) => ({
    ...m,
    probe: [m.name, m.subject, m.message].map((v) => (v ? probeKind(v) : null)).find(Boolean) ?? null,
  }));
  return (
    <ContactInboxClient
      messages={JSON.parse(JSON.stringify(flagged))}
      unhandled={unhandled}
      focusId={id ?? null}
    />
  );
}
