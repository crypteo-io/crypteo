// The admin dashboard lives on its own host, admin.<site host>
// (admin.crypteo.io), with its own URLs and layout: an admin isn't a
// merchant. proxy.ts serves app/admin there under bare paths (/merchants)
// and nowhere else. Derived from NEXTAUTH_URL, so local dev gets
// admin.localhost:<port> with no extra configuration.

const DEFAULT_SITE_URL = "https://crypteo.io";

function siteUrl(): URL {
  return new URL(process.env.NEXTAUTH_URL || DEFAULT_SITE_URL);
}

/** The merchant site's origin: https://crypteo.io */
export function siteOrigin(): string {
  return siteUrl().origin;
}

/** The admin dashboard's origin: https://admin.crypteo.io */
export function adminOrigin(): string {
  const url = siteUrl();
  url.hostname = `admin.${url.hostname}`;
  return url.origin;
}

/** Whether a request's Host header is the admin host. Exact, never a prefix. */
export function isAdminHost(host: string | null | undefined): boolean {
  return !!host && host.toLowerCase() === new URL(adminOrigin()).host;
}

/** An absolute link into the admin dashboard, for emails. */
export function adminUrl(path: string): string {
  return `${adminOrigin()}${path}`;
}

/**
 * An account's own dashboard page, absolute, for its emails: a merchant's
 * /dashboard/settings is /settings on the admin host for an admin.
 */
export function accountDashboardUrl(role: string, path: string): string {
  if (role === "admin") return adminUrl(path.replace(/^\/dashboard/, "") || "/");
  return `${siteOrigin()}${path}`;
}

/**
 * Who signs in where: admins only on the admin host, everyone else only on
 * the site. Null when this account may sign in on this host.
 */
export function signInHostRefusal(role: string, host: string | null | undefined): string | null {
  const onAdminHost = isAdminHost(host);
  if (role === "admin" && !onAdminHost) {
    return `Administrators sign in at ${new URL(adminOrigin()).host}.`;
  }
  if (role !== "admin" && onAdminHost) {
    return `This sign-in is for platform administrators. Sign in at ${new URL(siteOrigin()).host}.`;
  }
  return null;
}
