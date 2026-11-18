import { z } from "zod";

export const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[^\w\s]).{8,}$/;

export const passwordErrorMessage =
  "Password must be at least 8 characters long and include an uppercase letter, a lowercase letter, and a special character.";

export const isStrongPassword = (password: string) =>
  passwordRegex.test(password);

/**
 * A page on the merchant's own site the hosted checkout sends the buyer to
 * (successUrl, cancelUrl). Only http(s): the browser follows it, so a
 * javascript: or data: URL would run on the checkout's origin.
 */
export const returnUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((u) => URL.canParse(u) && ["http:", "https:"].includes(new URL(u).protocol), "Must be an http(s) URL");

/** A payment link's title and description, shown to buyers at checkout. */
export const linkTitleSchema = z.string().trim().min(1, "Title is required").max(200, "Title is too long (200 characters at most)");
export const linkDescriptionSchema = z
  .string()
  .max(2000, "Description is too long (2,000 characters at most)")
  .optional()
  .nullable();
