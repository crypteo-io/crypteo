// Limits shared by the notification writer, the admin message API and its
// dialog. Its own module so client components can import it without pulling
// the database client into the browser bundle.

export const TITLE_MAX = 120;
export const BODY_MAX = 2000;
/** One request mails each recipient in turn; past this, a broadcast is in-app only. */
export const MAX_EMAIL_RECIPIENTS = 200;
