"use client";

import TurnstileWidget from "@/components/TurnstileWidget";
import { Button } from "@/components/site/Button";
import { PageHero } from "@/components/site/PageHero";
import SiteShell from "@/components/site/SiteShell";
import { AlertCircle, BookOpen, CheckCircle, ChevronRight, CircleHelp, Mail } from "lucide-react";
import Link from "next/link";
import React, { useState } from "react";

const CHANNELS = [
  {
    icon: Mail,
    title: "Email support",
    body: "Account, payment or integration questions. Write to us any time.",
    label: "support@crypteo.io",
    href: "mailto:support@crypteo.io",
  },
  {
    icon: BookOpen,
    title: "API reference",
    body: "Endpoints, webhooks and test-mode keys, with examples for every call.",
    label: "Read the docs",
    href: "/docs",
  },
  {
    icon: CircleHelp,
    title: "Frequently asked questions",
    body: "Wallets, fees, supported coins and confirmation times, answered.",
    label: "Browse the FAQ",
    href: "/faq",
  },
];

const SUBJECTS = ["General Inquiry", "Technical Support", "Enterprise Sales", "Partnership"];

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "General Inquiry",
    message: "",
  });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Without a site key the widget renders nothing and the form takes its no-captcha path.
  const captchaRequired = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage("");

    if (!turnstileToken && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
      setErrorMessage("Please complete the captcha before sending.");
      setStatus("error");
      return;
    }

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, turnstileToken }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to send");

      setStatus("sent");
      setFormData({
        name: "",
        email: "",
        subject: "General Inquiry",
        message: "",
      });
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "An unexpected error occurred");
      setStatus("error");
    }
  };

  return (
    <SiteShell>
      <PageHero
        title="Contact us"
        subtitle="Questions about non-custodial payments, the API or your account? We're happy to help."
      />

      <section>
        <div className="container-site">
          <div className="grid gap-7.5 lg:grid-cols-3">
            {CHANNELS.map(({ icon: Icon, title, body, label, href }) => (
              <div key={title} className="frame">
                <div className="frame-inner flex h-full flex-col p-6">
                  <span className="icon-tile mb-7 size-15">
                    <Icon size={28} />
                  </span>
                  <h2 className="mb-2 text-xl">{title}</h2>
                  <p className="mb-7 flex-1 text-default-600">{body}</p>
                  <Link
                    href={href}
                    className="group inline-flex items-center gap-2.5 font-medium text-default-950 hover:text-primary"
                  >
                    {label}
                    <ChevronRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 md:py-28">
        <div className="container-site max-w-200!">
          <div className="mb-8 text-center md:mb-12">
            <h2 className="mb-3 text-[34px] leading-[1.15] md:text-[44px]">Send us a message</h2>
            <p className="text-lg text-default-600">A person on the team reads every message and replies by email.</p>
          </div>

          <div className="frame">
            <div className="frame-inner p-5 md:p-8">
              {status === "sent" ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <span className="icon-tile mb-6 size-15 text-sky">
                    <CheckCircle size={30} />
                  </span>
                  <h3 className="mb-3 text-[22px]">Message sent</h3>
                  <p className="max-w-sm text-default-600">
                    Thanks for reaching out. We&apos;ll reply to the email address you gave us.
                  </p>
                  <button
                    type="button"
                    onClick={() => setStatus("idle")}
                    className="mt-6 font-medium text-primary hover:underline"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  {status === "error" && (
                    <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 p-3">
                      <AlertCircle size={16} className="shrink-0 text-red-500" />
                      <p className="text-sm font-medium text-red-600">
                        {errorMessage || "Failed to send. Please try again or email us directly."}
                      </p>
                    </div>
                  )}
                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <label htmlFor="contact-name" className="mb-1.5 block font-medium text-default-900">
                        Name
                      </label>
                      <input
                        id="contact-name"
                        type="text"
                        name="name"
                        required
                        autoComplete="name"
                        value={formData.name}
                        onChange={handleChange}
                        className="field"
                        placeholder="Your name"
                      />
                    </div>
                    <div>
                      <label htmlFor="contact-email" className="mb-1.5 block font-medium text-default-900">
                        Email
                      </label>
                      <input
                        id="contact-email"
                        type="email"
                        name="email"
                        required
                        autoComplete="email"
                        value={formData.email}
                        onChange={handleChange}
                        className="field"
                        placeholder="you@example.com"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="contact-subject" className="mb-1.5 block font-medium text-default-900">
                      Subject
                    </label>
                    <select
                      id="contact-subject"
                      name="subject"
                      value={formData.subject}
                      onChange={handleChange}
                      className="field"
                    >
                      {SUBJECTS.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="contact-message" className="mb-1.5 block font-medium text-default-900">
                      Message
                    </label>
                    <textarea
                      id="contact-message"
                      name="message"
                      required
                      rows={5}
                      value={formData.message}
                      onChange={handleChange}
                      className="field h-auto resize-none py-3"
                      placeholder="How can we help?"
                    />
                  </div>

                  <TurnstileWidget onSuccess={setTurnstileToken} />

                  <Button
                    type="submit"
                    className="w-full sm:w-auto"
                    disabled={status === "sending" || (captchaRequired && !turnstileToken)}
                  >
                    {status === "sending" ? "Sending…" : "Send message"}
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
