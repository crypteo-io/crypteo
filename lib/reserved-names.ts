// Pure, so the signup form (client) and every name-setting route (server)
// share it. Guarded by lib/reserved-names.test.ts.

// The platform's own name, blocked anywhere in a merchant's name: a merchant
// called this looks like us on checkout pages and in every email the platform
// sends on their behalf.
const RESERVED_STEMS = ["crypteo"];

// System and authority words, blocked when a name is made only of them
// ("Admin", "Root User", "System Admin"). Whole words only: "Badminton Club"
// and "Rootstock Coffee" are real businesses.
const RESERVED_WORDS = new Set([
  "admin",
  "administrator",
  "admins",
  "anonymous",
  "billing",
  "guest",
  "helpdesk",
  "moderator",
  "noreply",
  "null",
  "official",
  "operator",
  "owner",
  "postmaster",
  "root",
  "security",
  "staff",
  "superuser",
  "sudo",
  "support",
  "sysadmin",
  "system",
  "team",
  "test",
  "undefined",
  "user",
  "users",
  "webmaster",
]);

// Look-alike characters folded before comparing, so "Crypt3o" and
// "R00T" are caught along with the plain spelling.
const LOOKALIKES: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  "$": "s",
  "!": "i",
  "|": "l",
};

export const RESERVED_NAME_MESSAGE =
  "That name is reserved for the platform. Use your own business name.";

function fold(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[013457@$!|]/g, (ch) => LOOKALIKES[ch] ?? ch);
}

export const DEMOTE_RESERVED_NAME_MESSAGE =
  "Rename this account before making it a merchant: its name is reserved for the platform.";

/**
 * Why this account may not use this name, or null. Admins speak for the
 * platform, so they may be "Admin" or "Crypteo"; a merchant may not.
 */
export function reservedNameRefusal(name: string, role: string): string | null {
  return role !== "admin" && isReservedName(name) ? RESERVED_NAME_MESSAGE : null;
}

/** Whether a display name impersonates the platform or a system account. */
export function isReservedName(name: string): boolean {
  const folded = fold(name);
  if (RESERVED_STEMS.some((stem) => folded.replace(/[^a-z]/g, "").includes(stem))) return true;
  const words = folded.split(/[^a-z]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => RESERVED_WORDS.has(w));
}

export const RESERVED_EMAIL_MESSAGE =
  "Addresses on the platform's domain are reserved. Use your own email address.";

export const DEMOTE_RESERVED_EMAIL_MESSAGE =
  "Change this account's email before making it a merchant: its address is on the platform's domain.";

/**
 * Whether an address is on the platform's domain or a look-alike of it
 * (crypteo.io, admin.crypteo.io, crypte-o.net). Accounts
 * signed up as platform-domain addresses: such an address
 * reads as staff in every list and email that shows it.
 */
export function isReservedEmail(email: string): boolean {
  const domain = fold(email.slice(email.lastIndexOf("@") + 1)).replace(/[^a-z]/g, "");
  return RESERVED_STEMS.some((stem) => domain.includes(stem));
}

/** Why this account may not use this address, or null. Like names, admins may. */
export function reservedEmailRefusal(email: string, role: string): string | null {
  return role !== "admin" && isReservedEmail(email) ? RESERVED_EMAIL_MESSAGE : null;
}
