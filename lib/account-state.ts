// Pure, so both the admin pages (client) and the admin routes (server) share it.

export const DELETED_EMAIL_DOMAIN = "@deleted.invalid";

export const ACCOUNT_STATES = ["active", "unverified", "suspended", "deleted"] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

export function isDeletedAccountEmail(email: string): boolean {
  return email.endsWith(DELETED_EMAIL_DOMAIN);
}

export function accountState(m: {
  email: string;
  isActive: boolean;
  emailVerified: Date | string | null;
}): AccountState {
  if (isDeletedAccountEmail(m.email)) return "deleted";
  if (!m.isActive) return "suspended";
  if (!m.emailVerified) return "unverified";
  return "active";
}
