import { signOut } from "next-auth/react";

/**
 * Sign out and land on this host's sign-in page. next-auth v4 resolves a
 * callbackUrl against NEXTAUTH_URL (its redirect callback never sees the
 * request), so signOut({ callbackUrl }) sent an admin on the admin host to
 * the merchant site's login.
 */
export async function signOutHere(path = "/login") {
  await signOut({ redirect: false });
  window.location.assign(path);
}
