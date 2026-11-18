// Why an account is suspended. An admin picks one in the suspend dialog; the
// automatic suspension (lib/account-risk.ts) records its own. The admin label
// is stored on the account; the merchant only ever reads the vague line, since
// naming the rule that tripped teaches a prober how to stay under it. "Other"
// keeps the admin's note on the record and tells the merchant the generic line.

export const SUSPENSION_REASONS = [
  {
    key: "security_testing",
    label: "Probing or testing the platform's security",
    merchantLine: "requests that looked like someone testing our security",
  },
  {
    key: "fraud",
    label: "Suspected fraud or scam",
    merchantLine: "signs that buyers paying you could be at risk",
  },
  {
    key: "prohibited_business",
    label: "Prohibited goods or services",
    merchantLine: "selling that falls outside what our terms allow",
  },
  {
    key: "false_identity",
    label: "Fake or throwaway identity",
    merchantLine: "account details we weren't able to verify",
  },
  {
    key: "complaints",
    label: "Complaints from buyers or other merchants",
    merchantLine: "reports about your account from other people",
  },
  {
    key: "other",
    label: "Other",
    merchantLine: "activity that doesn't fit how Crypteo is meant to be used",
  },
] as const;

export type SuspensionReasonKey = (typeof SUSPENSION_REASONS)[number]["key"];
export const SUSPENSION_REASON_KEYS = SUSPENSION_REASONS.map((r) => r.key) as [SuspensionReasonKey, ...SuspensionReasonKey[]];

/** The contact-form subject a suspended merchant's links preselect. */
export const APPEAL_SUBJECT = "Account appeal";

/** Recorded by the automatic suspension; shown to the merchant like "other". */
export const SUSPENSION_AUTOMATIC = "automatic";

const GENERIC = SUSPENSION_REASONS.find((r) => r.key === "other")?.merchantLine ?? "";

/** The vague line a merchant reads for a stored reason (unknown keys get the generic one). */
export function merchantSuspensionLine(reason: string | null | undefined): string {
  return SUSPENSION_REASONS.find((r) => r.key === reason)?.merchantLine ?? GENERIC;
}

/** What admins read for a stored reason, with the note "Other" carries. */
export function adminSuspensionLabel(reason: string | null | undefined, note?: string | null): string {
  if (reason === SUSPENSION_AUTOMATIC) return "Suspended automatically (abuse signals)";
  const label = SUSPENSION_REASONS.find((r) => r.key === reason)?.label ?? "No reason recorded";
  return reason === "other" && note ? `Other: ${note}` : label;
}
