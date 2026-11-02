"use client";

import { PLATFORM_SUPPORT_EMAIL } from "@/lib/branding";
import { createContext, useContext, type ReactNode } from "react";

const Contact = createContext({ supportEmail: PLATFORM_SUPPORT_EMAIL, platformMark: true });

/**
 * What every checkout screen shows of its context: the support address (the
 * merchant's when set) and whether the Crypteo mark may stand in for a missing
 * merchant logo (never on the merchant's own domain).
 */
export function CheckoutContactProvider({
  email,
  platformMark,
  children,
}: {
  email: string | null;
  platformMark: boolean;
  children: ReactNode;
}) {
  return (
    <Contact.Provider value={{ supportEmail: email || PLATFORM_SUPPORT_EMAIL, platformMark }}>{children}</Contact.Provider>
  );
}

export const useSupportEmail = () => useContext(Contact).supportEmail;
export const usePlatformMark = () => useContext(Contact).platformMark;
