"use client";

import { LocalDate } from "@/components/ui/LocalDate";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { accountState } from "@/lib/account-state";
import { apiRequest } from "@/lib/api-client";
import { reservedEmailRefusal, reservedNameRefusal } from "@/lib/reserved-names";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { isStrongPassword, passwordErrorMessage } from "@/lib/validation";
import {
    BadgePercent, CheckCircle, CreditCard, Key, Link2, LogOut,
    MailCheck, MessageSquare, Receipt, Save, ShieldOff, ShieldPlus, Smartphone, Trash2, UserCog, Wallet
} from "lucide-react";
import { PageHeader } from "./PageHeader";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminStatementsTable, type AdminStatementRow } from "@/components/billing/AdminStatementsTable";
import { AccountStateBadge, PlatformEmailBadge, ReservedNameBadge } from "./MerchantsClient";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { MessageDialog } from "./MessageDialog";

interface Data {
  merchant: {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
    emailVerified: string | null;
    createdAt: string;
    twoFactorMethod: "email" | "totp";
    underpaidThreshold: number;
    feeExempt: boolean;
    feeExemptReason: string | null;
    feeExemptBy: string | null;
    feeExemptAt: string | null;
    billingHoldAt: string | null;
    wallets: { id: string; chain: string; token: string; address: string; isActive: boolean; createdAt: string }[];
    apiKeys: {
      id: string;
      keyPrefix: string;
      label: string | null;
      isActive: boolean;
      isTest: boolean;
      lastUsedAt: string | null;
      createdAt: string;
    }[];
    paymentLinks: { id: string; title: string; amount: number; isActive: boolean; createdAt: string }[];
    _count: { payments: number; paymentLinks: number; webhookEndpoints: number };
  };
  payments: {
    id: string;
    status: string;
    chain: string | null;
    token: string | null;
    expectedAmount: number;
    receivedAmount: number | null;
    isTest: boolean;
    createdAt: string;
  }[];
  statusCounts: { status: string; count: number }[];
  audit: {
    id: string;
    adminEmail: string;
    action: string;
    details: Record<string, unknown> | null;
    createdAt: string;
  }[];
  statements: AdminStatementRow[];
  now: string;
}

type ActionBody = Record<string, unknown> & { action: string };


const inputClass =
  "w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] font-medium text-default-800 focus:outline-none focus:ring-4 focus:ring-sky/10 focus:border-sky transition-all";
const labelClass = "text-[13px] font-medium text-default-700 pl-1";
const thClass = "px-6 py-3 text-[13px] font-medium text-default-700";
const tdClass = "px-6 py-3 text-[13px] text-default-600";

const AUDIT_LABELS: Record<string, string> = {
  create: "Account created",
  delete: "Account deleted",
  setActive: "Status changed",
  updateProfile: "Profile edited",
  setRole: "Role changed",
  resetPassword: "Password reset",
  resetTwoFactor: "Two-factor reset to email",
  verifyEmail: "Email marked verified",
  revokeSessions: "Signed out everywhere",
  setFeeExempt: "Fee exemption changed",
  sendMessage: "Message sent",
  "statement:markPaid": "Invoice marked paid",
  "statement:waive": "Invoice waived",
  "statement:extend": "Invoice due date extended",
  setApiKeyActive: "API key changed",
  setWalletActive: "Wallet changed",
  setPaymentLinkActive: "Payment link changed",
};

export function MerchantAdminClient({ data, isSelf }: { data: Data; isSelf: boolean }) {
  const router = useRouter();
  const { merchant } = data;
  const state = accountState(merchant);
  const isDeleted = state === "deleted";

  const [name, setName] = useState(merchant.name);
  const [email, setEmail] = useState(merchant.email);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [exempting, setExempting] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const confirmDialog = useConfirm();

  const call = async (
    method: "PATCH" | "DELETE",
    body: ActionBody | null,
    success: string,
  ): Promise<boolean> => {
    setBusy(true);
    try {
      await toast.promise(
        apiRequest(`/api/admin/merchants/${merchant.id}`, { method, body: body ?? undefined }),
        { loading: "Saving…", success, error: "Change not saved" },
      );
      router.refresh();
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Ask first, then run the action. */
  const confirm = async (
    c: { title: string; body: string; confirmLabel: string; danger?: boolean },
    body: ActionBody,
    success: string,
  ) => {
    const ok = await confirmDialog({
      title: c.title,
      description: c.body,
      confirmLabel: c.confirmLabel,
      tone: c.danger ? "danger" : "default",
    });
    if (ok) await call("PATCH", body, success);
  };

  const saveProfile = () => {
    const changes: ActionBody = { action: "updateProfile" };
    if (name.trim() !== merchant.name) changes.name = name;
    if (email.trim().toLowerCase() !== merchant.email) changes.email = email;
    if (!changes.name && !changes.email) {
      toast.info("Nothing to save", "The name and email are unchanged.");
      return;
    }
    const nameRefusal = typeof changes.name === "string" ? reservedNameRefusal(changes.name, merchant.role) : null;
    if (nameRefusal) {
      toast.warning("Name not allowed", nameRefusal);
      return;
    }
    const emailRefusal = typeof changes.email === "string" ? reservedEmailRefusal(changes.email, merchant.role) : null;
    if (emailRefusal) {
      toast.warning("Email not allowed", emailRefusal);
      return;
    }
    if (changes.email) {
      void confirm(
        {
          title: "Change login email?",
          body: `${merchant.name} will sign in, and receive codes and payment notices, at ${email}. The old address is notified.`,
          confirmLabel: "Change email",
        },
        changes,
        "Profile updated",
      );
      return;
    }
    void call("PATCH", changes, "Profile updated");
  };

  const resetPassword = () => {
    if (!isStrongPassword(newPassword)) {
      toast.warning("Password too weak", passwordErrorMessage);
      return;
    }
    void confirm(
      {
        title: "Set a new password?",
        body: "Every open session is signed out and the merchant is emailed that an administrator reset their password. Share the new password with them securely.",
        confirmLabel: "Reset password",
        danger: true,
      },
      { action: "resetPassword", newPassword },
      "Password reset; their sessions are signed out",
    ).then(() => setNewPassword(""));
  };

  const toggle = async (
    isActive: boolean,
    what: string,
    disableEffect: string,
    body: ActionBody,
  ) => {
    if (isActive) {
      await confirm(
        { title: `Disable this ${what}?`, body: disableEffect, confirmLabel: "Disable", danger: true },
        body,
        `${what[0].toUpperCase()}${what.slice(1)} disabled`,
      );
      return;
    }
    await call("PATCH", body, `${what[0].toUpperCase()}${what.slice(1)} enabled`);
  };

  const deleteAccount = async () => {
    const ok = await confirmDialog({
      title: "Delete this account?",
      description:
        "The account is deactivated and its personal data scrubbed; wallets, keys and links are disabled. Payment records are kept. This can't be undone.",
      confirmLabel: "Delete account",
      tone: "danger",
    });
    if (ok && (await call("DELETE", null, "Account deleted"))) router.push("/merchants");
  };

  const totals = data.statusCounts.reduce<Record<string, number>>(
    (acc, s) => ({ ...acc, [s.status]: s.count }),
    {},
  );
  const paid = (totals.confirmed ?? 0) + (totals.overpaid ?? 0);

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title={<span className="break-all">{merchant.name}</span>}
        backHref="/merchants"
        backLabel="Back to merchants"
        actions={
          !isDeleted && (
            <button
              onClick={() => setMessaging(true)}
              className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-semibold text-white shadow-aigocy-dark transition-colors hover:bg-primary-deep cursor-pointer"
            >
              <MessageSquare size={15} /> Send message
            </button>
          )
        }
        badge={
          <>
            <AccountStateBadge state={state} />
            <span className="px-2.5 py-0.5 bg-default-100 border border-default-200 rounded-pill text-[12px] font-semibold capitalize text-default-600">
              {merchant.role}
            </span>
            {isSelf && (
              <span className="px-2.5 py-0.5 bg-sky/5 border border-sky/15 rounded-pill text-[12px] font-semibold text-sky">You</span>
            )}
            {reservedNameRefusal(merchant.name, merchant.role) && <ReservedNameBadge />}
            {reservedEmailRefusal(merchant.email, merchant.role) && <PlatformEmailBadge />}
            {merchant.billingHoldAt && (
              <span className="px-2.5 py-0.5 bg-accent-red/5 border border-accent-red/20 rounded-pill text-[12px] font-semibold text-accent-red">
                Billing hold
              </span>
            )}
            {merchant.feeExempt && (
              <span className="px-2.5 py-0.5 bg-default-100 border border-default-200 rounded-pill text-[12px] font-semibold text-default-600">
                Fee exempt
              </span>
            )}
          </>
        }
        subtitle={
          <span className="break-all">
            {merchant.email} · joined{" "}
            <LocalDate value={merchant.createdAt} options={{ month: "short", day: "numeric", year: "numeric" }} />
            {" · "}
            <span className="font-mono text-[12px]">{merchant.id}</span>
          </span>
        }
      />
      {exempting && (
        <PromptDialog
          title="Exempt this account from fees?"
          description="For the platform's own apps and agreed partners. Statements skip this account from its next billing month close; open invoices stay open (waive them separately). The reason is kept on the account and every admin is notified."
          label="Reason (kept on record)"
          placeholder="e.g. Our own app: Crypteo Shop"
          confirmLabel="Exempt from fees"
          danger
          onClose={() => setExempting(false)}
          onSubmit={async (reason) => {
            if (await call("PATCH", { action: "setFeeExempt", feeExempt: true, reason }, "Exempt from platform fees")) {
              setExempting(false);
            }
          }}
        />
      )}
      {promoting && (
        <PromptDialog
          title="Grant admin access?"
          description={`${merchant.name} will be able to view and change every merchant account on the platform, including other admins. Every admin is emailed.`}
          label="Your password"
          minLength={1}
          maxLength={200}
          secret
          confirmLabel="Make admin"
          danger
          onClose={() => setPromoting(false)}
          onSubmit={async (password) => {
            if (await call("PATCH", { action: "setRole", role: "admin", password }, "Now an admin")) {
              setPromoting(false);
            }
          }}
        />
      )}
      {messaging && (
        <MessageDialog
          audience={{ kind: "direct", merchants: [{ id: merchant.id, name: merchant.name, email: merchant.email }] }}
          onClose={() => {
            setMessaging(false);
            router.refresh();
          }}
        />
      )}

      {/* STATS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Payments", value: merchant._count.payments, icon: CreditCard },
          { label: "Paid (live)", value: paid, icon: CheckCircle },
          { label: "Wallets", value: merchant.wallets.length, icon: Wallet },
          { label: "API keys", value: merchant.apiKeys.length, icon: Key },
        ].map((s) => (
          <div key={s.label} className="frame">
          <div className="frame-inner h-full p-5">
            <div className="flex size-11 items-center justify-center rounded-xl bg-sky/8 text-sky">
              <s.icon size={20} />
            </div>
            <p className="mt-4 text-[13px] text-default-500">{s.label}</p>
            <p className="font-heading text-[24px] font-semibold tabular-nums text-default-950">{s.value}</p>
          </div>
          </div>
        ))}
      </div>

      {!isDeleted && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* PROFILE */}
          <section className="frame">
          <div className={cn("frame-inner h-full", "p-6 space-y-5")}>
            <h2 className="text-[17px] font-heading font-semibold text-default-900">Profile</h2>
            <div className="space-y-2">
              <label className={labelClass}>Company Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Login Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-default-500">
              <span>
                Webhooks: {merchant._count.webhookEndpoints || "none"} · Paid at ≥
                {Math.round(merchant.underpaidThreshold * 100)}%
              </span>
              <button
                onClick={saveProfile}
                disabled={busy}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl text-[13px] font-semibold hover:bg-primary-deep disabled:opacity-50 cursor-pointer"
              >
                <Save size={14} /> Save profile
              </button>
            </div>
          </div>
          </section>

          {/* ACCESS */}
          <section className="frame">
          <div className={cn("frame-inner h-full", "p-6 space-y-5")}>
            <h2 className="text-[17px] font-heading font-semibold text-default-900">Access & security</h2>
            <p className="text-[13px] text-default-500">
              Second factor:{" "}
              <span className="font-semibold text-default-800">
                {merchant.twoFactorMethod === "totp" ? "Authenticator app" : "Email code"}
              </span>
              . Changes here email the merchant.
            </p>
            <div className="flex flex-wrap gap-2">
              {merchant.isActive ? (
                <ActionButton
                  icon={ShieldOff}
                  label="Suspend (ban)"
                  disabled={busy || isSelf}
                  onClick={() =>
                    confirm(
                      {
                        title: "Suspend this account?",
                        body: "The merchant is signed out within 5 minutes, their API keys stop working and their payment links stop opening new checkouts. Open checkouts keep being watched so buyers who already paid are credited. Nothing is deleted.",
                        confirmLabel: "Suspend",
                        danger: true,
                      },
                      { action: "setActive", isActive: false },
                      "Account suspended",
                    )
                  }
                />
              ) : (
                <ActionButton
                  icon={ShieldPlus}
                  label="Reactivate (unban)"
                  disabled={busy}
                  onClick={() => void call("PATCH", { action: "setActive", isActive: true }, "Account reactivated")}
                />
              )}
              {merchant.role === "merchant" && (
                <ActionButton
                  icon={BadgePercent}
                  label={merchant.feeExempt ? "Charge platform fees" : "Exempt from fees"}
                  disabled={busy}
                  onClick={() =>
                    merchant.feeExempt
                      ? confirm(
                          {
                            title: "Charge platform fees again?",
                            body: "Sales are billed at the platform rate from this account's next billing month close. Every admin is notified.",
                            confirmLabel: "Charge fees",
                          },
                          { action: "setFeeExempt", feeExempt: false },
                          "Platform fees apply",
                        )
                      : setExempting(true)
                  }
                />
              )}
              {!merchant.emailVerified && (
                <ActionButton
                  icon={MailCheck}
                  label="Mark email verified"
                  disabled={busy}
                  onClick={() => void call("PATCH", { action: "verifyEmail" }, "Email marked verified")}
                />
              )}
              {merchant.twoFactorMethod === "totp" && (
                <ActionButton
                  icon={Smartphone}
                  label="Reset 2FA to email"
                  disabled={busy}
                  onClick={() =>
                    confirm(
                      {
                        title: "Remove their authenticator?",
                        body: "Use this when the merchant has lost their device. Sign-in codes go back to their email address until they set up a new authenticator.",
                        confirmLabel: "Reset to email",
                      },
                      { action: "resetTwoFactor" },
                      "Two-factor reset to email codes",
                    )
                  }
                />
              )}
              <ActionButton
                icon={LogOut}
                label="Sign out everywhere"
                disabled={busy}
                onClick={() =>
                  confirm(
                    {
                      title: "Sign out everywhere?",
                      body: "Every session this account has open ends within 5 minutes, on every device. Their API keys keep working.",
                      confirmLabel: "Sign out everywhere",
                      danger: true,
                    },
                    { action: "revokeSessions" },
                    "Sessions revoked; they end within 5 minutes",
                  )
                }
              />
            </div>
            <div className="space-y-2 pt-2 border-t border-default-200">
              <label className={labelClass}>Set a new password</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={cn(inputClass, "font-mono")}
                />
                <button
                  onClick={resetPassword}
                  disabled={busy || !newPassword}
                  className="px-5 py-2.5 rounded-xl border border-default-200 text-[13px] font-semibold text-default-700 hover:border-default-300 disabled:opacity-50 cursor-pointer shrink-0"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
          </section>
        </div>
      )}

      {/* BILLING */}
      {merchant.role === "merchant" && (
        <section className="frame">
        <div className="frame-inner overflow-hidden">
          <div className="px-5 py-4 sm:px-6 border-b border-default-200 flex flex-wrap items-center gap-2.5">
            <Receipt size={16} className="text-sky" />
            <h2 className="text-[15px] font-heading font-semibold text-default-950">Platform fees</h2>
            {merchant.billingHoldAt && (
              <span className="ml-auto text-[12px] font-semibold text-accent-red">
                Checkouts paused since <LocalDate value={merchant.billingHoldAt} withTime />
              </span>
            )}
          </div>
          {merchant.feeExempt && (
            <p className="px-5 sm:px-6 py-3 text-[13px] text-default-600 border-b border-default-200 bg-amber-50/50">
              Exempt from fees{merchant.feeExemptReason ? `: ${merchant.feeExemptReason}` : ""}
              {merchant.feeExemptBy && (
                <span className="text-default-500">
                  {" "}· granted by {merchant.feeExemptBy}
                  {merchant.feeExemptAt && (
                    <>
                      {" "}on <LocalDate value={merchant.feeExemptAt} options={{ month: "short", day: "numeric", year: "numeric" }} />
                    </>
                  )}
                </span>
              )}
            </p>
          )}
          <AdminStatementsTable rows={data.statements} now={data.now} showMerchant={false} empty="No fee statements yet." />
        </div>
        </section>
      )}

      {/* WALLETS */}
      <TableSection title="Receiving wallets" icon={Wallet} empty="No wallets configured." rows={merchant.wallets.length}>
        <thead>
          <tr className="border-b border-default-200 bg-default-50">
            <th className={thClass}>Network</th>
            <th className={thClass}>Address</th>
            <th className={thClass}>Added</th>
            <th className={cn(thClass, "text-right")}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-default-100">
          {merchant.wallets.map((w) => (
            <tr key={w.id}>
              <td className={cn(tdClass, "uppercase font-semibold whitespace-nowrap")}>
                {w.chain} · {w.token}
              </td>
              <td data-label="Address" className={cn(tdClass, "font-mono text-[12px] break-all")}>{w.address}</td>
              <td data-label="Added" className={cn(tdClass, "whitespace-nowrap")}>
                <LocalDate value={w.createdAt} options={{ month: "short", day: "numeric", year: "numeric" }} />
              </td>
              <td data-label="Status" className={cn(tdClass, "text-right")}>
                <Toggle
                  isActive={w.isActive}
                  disabled={busy || isDeleted}
                  onToggle={() =>
                    toggle(
                      w.isActive,
                      "wallet",
                      `New checkouts can no longer use this ${w.chain.toUpperCase()} · ${w.token.toUpperCase()} address. Sessions already on it keep being watched.`,
                      { action: "setWalletActive", walletId: w.id, isActive: !w.isActive },
                    )
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </TableSection>

      {/* API KEYS */}
      <TableSection title="API keys" icon={Key} empty="No API keys." rows={merchant.apiKeys.length}>
        <thead>
          <tr className="border-b border-default-200 bg-default-50">
            <th className={thClass}>Key</th>
            <th className={thClass}>Mode</th>
            <th className={thClass}>Last used</th>
            <th className={cn(thClass, "text-right")}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-default-100">
          {merchant.apiKeys.map((k) => (
            <tr key={k.id}>
              <td className={tdClass}>
                <span className="font-mono text-[12px]">{k.keyPrefix}…</span>
                {k.label && <span className="ml-2 text-default-500">{k.label}</span>}
              </td>
              <td data-label="Mode" className={tdClass}>{k.isTest ? "Test" : "Live"}</td>
              <td data-label="Last used" className={cn(tdClass, "whitespace-nowrap")}>
                {k.lastUsedAt ? <LocalDate value={k.lastUsedAt} withTime /> : "Never"}
              </td>
              <td data-label="Status" className={cn(tdClass, "text-right")}>
                <Toggle
                  isActive={k.isActive}
                  disabled={busy || isDeleted}
                  onToggle={() =>
                    toggle(
                      k.isActive,
                      "API key",
                      "Requests signed with this key are refused immediately. The merchant can create a new one.",
                      { action: "setApiKeyActive", keyId: k.id, isActive: !k.isActive },
                    )
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </TableSection>

      {/* PAYMENT LINKS */}
      <TableSection
        title={`Payment links${merchant._count.paymentLinks > merchant.paymentLinks.length ? ` (newest ${merchant.paymentLinks.length} of ${merchant._count.paymentLinks})` : ""}`}
        icon={Link2}
        empty="No payment links."
        rows={merchant.paymentLinks.length}
      >
        <thead>
          <tr className="border-b border-default-200 bg-default-50">
            <th className={thClass}>Title</th>
            <th className={thClass}>Amount</th>
            <th className={thClass}>Created</th>
            <th className={cn(thClass, "text-right")}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-default-100">
          {merchant.paymentLinks.map((l) => (
            <tr key={l.id}>
              <td className={cn(tdClass, "font-medium text-default-800")}>{l.title}</td>
              <td data-label="Amount" className={tdClass}>${l.amount}</td>
              <td data-label="Created" className={cn(tdClass, "whitespace-nowrap")}>
                <LocalDate value={l.createdAt} options={{ month: "short", day: "numeric", year: "numeric" }} />
              </td>
              <td data-label="Status" className={cn(tdClass, "text-right")}>
                <Toggle
                  isActive={l.isActive}
                  disabled={busy || isDeleted}
                  onToggle={() =>
                    toggle(
                      l.isActive,
                      "payment link",
                      "The link stops opening new checkouts. Sessions already started keep being watched.",
                      { action: "setPaymentLinkActive", linkId: l.id, isActive: !l.isActive },
                    )
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </TableSection>

      {/* PAYMENTS */}
      <TableSection
        title={`Recent payments (${data.payments.length} of ${merchant._count.payments})`}
        icon={CreditCard}
        empty="No payments yet."
        rows={data.payments.length}
      >
        <thead>
          <tr className="border-b border-default-200 bg-default-50">
            <th className={thClass}>Session</th>
            <th className={cn(thClass, "hidden xl:table-cell")}>Network</th>
            <th className={thClass}>Expected / received</th>
            <th className={cn(thClass, "hidden xl:table-cell")}>Created</th>
            <th className={cn(thClass, "text-right")}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-default-100">
          {data.payments.map((p) => (
            <tr key={p.id}>
              <td className={cn(tdClass, "font-mono text-[12px]")}>
                {p.id}
                {p.isTest && <span className="ml-2 text-[10px] font-semibold text-amber-600 uppercase">Test</span>}
              </td>
              <td data-label="Network" className={cn(tdClass, "hidden xl:table-cell uppercase whitespace-nowrap")}>
                {p.chain ? `${p.chain} · ${p.token}` : "Not chosen"}
              </td>
              <td data-label="Expected / received" className={cn(tdClass, "whitespace-nowrap")}>
                {p.expectedAmount} / {p.receivedAmount ?? "–"}
              </td>
              <td data-label="Created" className={cn(tdClass, "hidden xl:table-cell whitespace-nowrap")}>
                <LocalDate value={p.createdAt} withTime />
              </td>
              <td data-label="Status" className={cn(tdClass, "text-right")}>
                <StatusBadge status={p.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </TableSection>

      {/* AUDIT */}
      <TableSection title="Admin activity" icon={UserCog} empty="No admin changes yet." rows={data.audit.length}>
        <thead>
          <tr className="border-b border-default-200 bg-default-50">
            <th className={thClass}>When</th>
            <th className={thClass}>Admin</th>
            <th className={thClass}>Change</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-default-100">
          {data.audit.map((a) => (
            <tr key={a.id}>
              <td className={cn(tdClass, "whitespace-nowrap")}>
                <LocalDate value={a.createdAt} withTime />
              </td>
              <td data-label="Admin" className={tdClass}>{a.adminEmail}</td>
              <td data-label="Change" className={tdClass}>
                <div>
                  {AUDIT_LABELS[a.action] ?? a.action}
                  {a.details && Object.keys(a.details).length > 0 && (
                    <span className="ml-2 font-mono text-[11px] text-default-500 break-all">
                      {JSON.stringify(a.details)}
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableSection>

      {!isDeleted && !isSelf && (
        <section className="frame">
        <div className={cn("frame-inner h-full", "p-6 border-accent-red/20 flex flex-col md:flex-row md:items-center justify-between gap-4")}>
          <div>
            <h2 className="text-[17px] font-heading font-semibold text-default-950">Delete account</h2>
            <p className="text-[13px] text-default-500 mt-1 max-w-xl">
              Deactivates the account and scrubs its personal data. Payment records are kept. Prefer
              suspending if the account may come back.
            </p>
          </div>
          <button
            onClick={deleteAccount}
            disabled={busy}
            className="flex items-center gap-2 bg-accent-red/5 text-accent-red hover:bg-accent-red hover:text-white border border-accent-red/20 font-semibold py-2.5 px-5 rounded-xl transition-all text-[13px] disabled:opacity-50 cursor-pointer shrink-0"
          >
            <Trash2 size={14} /> Delete account
          </button>
        </div>
        </section>
      )}

      {!isDeleted && (
        <section className="frame">
        <div className={cn("frame-inner h-full", "p-6 flex flex-col md:flex-row md:items-center justify-between gap-4")}>
          <div>
            <h2 className="text-[17px] font-heading font-semibold text-default-950">Platform role</h2>
            <p className="text-[13px] text-default-500 mt-1 max-w-xl">
              {isSelf
                ? "You can't change your own role. Another admin can."
                : merchant.role === "admin"
                  ? "This account is an admin: it can view and change every account on the platform."
                  : "Admins can view and change every account on the platform, including other admins."}
            </p>
          </div>
          <ActionButton
            icon={UserCog}
            label={merchant.role === "admin" ? "Make merchant" : "Make admin"}
            disabled={busy || isSelf}
            onClick={() => {
              if (merchant.role !== "admin") {
                setPromoting(true);
                return;
              }
              void confirm(
                {
                  title: "Remove admin access?",
                  body: "This account loses access to merchant management. Its open sessions are signed out.",
                  confirmLabel: "Make merchant",
                  danger: true,
                },
                { action: "setRole", role: "merchant" },
                "Admin access removed",
              );
            }}
          />
        </div>
        </section>
      )}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Save;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-default-200 text-[13px] font-semibold text-default-700 hover:border-default-300 hover:text-default-950 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
    >
      <Icon size={14} /> {label}
    </button>
  );
}

function Toggle({
  isActive,
  onToggle,
  disabled,
}: {
  isActive: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "px-3 py-1 rounded-pill text-[11px] font-semibold border disabled:opacity-50 cursor-pointer",
        isActive
          ? "bg-accent-green/5 text-accent-green border-accent-green/10 hover:bg-accent-red/5 hover:text-accent-red hover:border-accent-red/10"
          : "bg-default-100 text-default-500 border-default-200 hover:text-accent-green",
      )}
      title={isActive ? "Click to disable" : "Click to enable"}
    >
      {isActive ? "Active" : "Disabled"}
    </button>
  );
}

function TableSection({
  title,
  icon: Icon,
  empty,
  rows,
  children,
}: {
  title: string;
  icon: typeof Save;
  empty: string;
  rows: number;
  children: React.ReactNode;
}) {
  return (
    <section className="frame">
      <div className="frame-inner overflow-hidden">
        <div className="px-5 py-4 sm:px-6 border-b border-default-200 flex items-center gap-2.5">
          <Icon size={16} className="text-sky" />
          <h2 className="text-[15px] font-heading font-semibold text-default-950">{title}</h2>
          <span className="rounded-md bg-default-100 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-default-600">
            {rows}
          </span>
        </div>
        {rows === 0 ? (
          <p className="px-6 py-8 text-[13px] text-default-500">{empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left stack-table">{children}</table>
          </div>
        )}
      </div>
    </section>
  );
}
