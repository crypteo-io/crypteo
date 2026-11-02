"use client";

import { PLATFORM_SUPPORT_EMAIL } from "@/lib/branding";
import { createContext, useContext, type ReactNode } from "react";

const SupportEmail = createContext(PLATFORM_SUPPORT_EMAIL);

/** The support address every checkout screen offers: the merchant's when set. */
export function CheckoutContactProvider({ email, children }: { email: string | null; children: ReactNode }) {
  return <SupportEmail.Provider value={email || PLATFORM_SUPPORT_EMAIL}>{children}</SupportEmail.Provider>;
}

export const useSupportEmail = () => useContext(SupportEmail);
