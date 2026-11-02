import { z } from "zod";
import { isReservedName, RESERVED_NAME_MESSAGE } from "./reserved-names";
import { passwordErrorMessage, passwordRegex } from "./validation";

// The name is rendered in the dashboard and interpolated into every merchant
// email; control characters (incl. CR/LF and bidi overrides) have no business
// in a display name.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
// Any account's name. Whether it may be a reserved one depends on the
// account's role (reservedNameRefusal), which each rename checks.
export const accountNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(100, "Name must be at most 100 characters")
  .refine((v) => !CONTROL_CHARS.test(v), "Name contains invalid characters");

/** A merchant's name: never a reserved one. Signups are always merchants. */
export const merchantNameSchema = accountNameSchema.refine((v) => !isReservedName(v), RESERVED_NAME_MESSAGE);

export const merchantEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(254));

export const passwordSchema = z.string().regex(passwordRegex, passwordErrorMessage);
