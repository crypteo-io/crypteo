"use client";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { apiRequest } from "@/lib/api-client";
import { reservedNameRefusal } from "@/lib/reserved-names";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { isStrongPassword, passwordErrorMessage } from "@/lib/validation";
import { Merchant } from "@/types/payment";
import gsap from "gsap";
import {
    AlertCircle, Globe, Lock, LogOut, Percent, Save, Shield, Trash2, User
} from "lucide-react";
import { useSession } from "next-auth/react";
import { signOutHere } from "@/lib/sign-out";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DashboardArea } from "../layout/nav-items";
import { ActionButton } from "./ActionButton";
import { PageHeader } from "./PageHeader";
import { TwoFactorSettings } from "./TwoFactorSettings";
import { WebhookSettings } from "./WebhookSettings";
import { SecretInput } from "@/components/ui/SecretInput";

const ACCOUNT_TABS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "security", label: "Security", icon: Shield },
];
// Webhooks and payment tolerance belong to a merchant's integration.
const MERCHANT_TABS = [
  ...ACCOUNT_TABS,
  { id: "webhooks", label: "Webhooks", icon: Globe },
  { id: "payments", label: "Payments", icon: Percent },
];

export function SettingsClient({
  user,
  initialTab,
  area,
}: {
  user: Merchant;
  initialTab?: string;
  area: DashboardArea;
}) {
  const tabs = area === "admin" ? ACCOUNT_TABS : MERCHANT_TABS;
  const router = useRouter();
  const { update } = useSession();
  const [activeTab, setActiveTab] = useState(
    tabs.some((t) => t.id === initialTab) ? initialTab! : "profile",
  );
  const [name, setName] = useState(user.name || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // Stored as a ratio (0.99); edited here as a percentage (99).
  const [underpaidPercent, setUnderpaidPercent] = useState("99");
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const items = el.querySelectorAll(".animate-up");
    gsap.set(items, { opacity: 1, y: 0 });
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".animate-up",
        { y: 20, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.6,
          stagger: 0.05,
          ease: "power2.out",
          clearProps: "all",
        },
      );
    }, containerRef);
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    fetch("/api/merchants/settings")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.underpaidThreshold === "number")
          setUnderpaidPercent(String(Math.round(data.underpaidThreshold * 100)));
      })
      .catch(() => {});
  }, []);

  useLayoutEffect(() => {
    if (activeTab) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, x: 10 },
        { opacity: 1, x: 0, duration: 0.5 },
      );
    }
  }, [activeTab]);

  /** Run one save with a loading → result toast; resolves to whether it worked. */
  const save = async <T,>(
    request: () => Promise<T>,
    messages: { loading: string; success: string; error: string },
  ): Promise<T | null> => {
    setSaving(true);
    try {
      return await toast.promise(request, messages);
    } catch {
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleProfileSave = async () => {
    const nameRefusal = reservedNameRefusal(name, user.role);
    if (nameRefusal) {
      toast.warning("Name not allowed", nameRefusal);
      return;
    }
    const ok = await save(() => apiRequest("/api/merchants", { method: "PUT", body: { name } }), {
      loading: "Saving profile…",
      success: "Profile updated",
      error: "Profile not saved",
    });
    if (ok) {
      await update({ name });
      router.refresh();
    }
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Delete your account?",
      description:
        "Your account is deactivated and your personal data removed. Your wallets, API keys and payment links stop working immediately. Payment records are kept for accounting. This can't be undone.",
      confirmLabel: "Delete my account",
      tone: "danger",
    });
    if (!confirmed) return;
    const ok = await save(() => apiRequest("/api/merchants", { method: "DELETE" }), {
      loading: "Deleting account…",
      success: "Account deleted",
      error: "Account not deleted",
    });
    if (ok) await signOutHere();
  };

  const handleLogout = async () => {
    const confirmed = await confirm({
      title: "Log out?",
      description: "You'll need your password and a verification code to sign back in.",
      confirmLabel: "Log out",
    });
    if (confirmed) await signOutHere();
  };

  const handlePasswordChange = async () => {
    if (newPassword !== confirmPassword) {
      toast.warning("Passwords don't match", "Type the new password the same way twice.");
      return;
    }
    if (!isStrongPassword(newPassword)) {
      toast.warning("Password too weak", passwordErrorMessage);
      return;
    }
    const ok = await save(
      () => apiRequest("/api/merchants", { method: "PATCH", body: { currentPassword, newPassword } }),
      {
        loading: "Changing password…",
        success: "Password changed; other sessions are signed out",
        error: "Password not changed",
      },
    );
    if (ok) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  };

  const handlePaymentsSave = async () => {
    const percent = Math.round(Number(underpaidPercent));
    if (!Number.isFinite(percent) || percent < 95 || percent > 100) {
      toast.warning("Threshold out of range", "Use a whole number between 95% and 100%.");
      return;
    }
    await save(
      () =>
        apiRequest("/api/merchants/settings", {
          method: "PUT",
          body: { underpaidThreshold: percent / 100 },
        }),
      { loading: "Saving…", success: "Payment settings saved", error: "Settings not saved" },
    );
  };

  return (
    <div ref={containerRef} className="space-y-8 pb-12">
      <div className="animate-up">
        <PageHeader
          title="Settings"
          subtitle="Account, security, webhooks and payment tolerances."
          actions={
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-xl border border-default-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-default-700 transition-colors hover:border-accent-red/20 hover:bg-accent-red/5 hover:text-accent-red cursor-pointer"
            >
              <LogOut size={15} /> Log out
            </button>
          }
        />
      </div>

      <div className="space-y-6 animate-up">
        <div
          role="tablist"
          aria-label="Settings sections"
          className="flex w-full gap-1 overflow-x-auto rounded-xl border border-default-200 bg-default-100 p-1 sm:w-fit"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors cursor-pointer",
                activeTab === t.id
                  ? "bg-white text-default-950 shadow-premium"
                  : "text-default-500 hover:text-default-900",
              )}
            >
              <t.icon size={15} className={activeTab === t.id ? "text-sky" : "text-default-400"} />
              {t.label}
            </button>
          ))}
        </div>

        {/* CONTENT AREA */}
        <div ref={contentRef} className="max-w-4xl space-y-8">
          {activeTab === "profile" && (
            <div className="frame">
            <div className="frame-inner p-5 sm:p-8 space-y-8">
              <div>
                <h2 className="text-[20px] font-heading font-semibold text-default-950 tracking-tight mb-1">
                  Profile Information
                </h2>
                <p className="text-[14px] text-default-500 font-body">
                  Update your account details and contact information.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[13px] font-medium text-default-700 pl-1">
                    Company Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] font-medium text-default-800 focus:outline-none focus:ring-4 focus:ring-sky/10 focus:border-sky transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[13px] font-medium text-default-700 pl-1">
                    Login Email (Fixed)
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      value={user.email || ""}
                      disabled
                      className="w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] font-medium text-default-500 cursor-not-allowed pr-10"
                    />
                    <Lock
                      size={14}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-default-400"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-3 items-center">
                <p className="text-[12px] text-default-500 font-medium italic">
                  All changes are immediate.
                </p>
                <ActionButton
                  onClick={handleProfileSave}
                  disabled={saving}
                  variant="primary"
                  className="px-8 py-3"
                >
                  {saving ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <span className="flex items-center gap-2">
                      <Save size={16} /> Save Changes
                    </span>
                  )}
                </ActionButton>
              </div>
            </div>
            </div>
          )}

          {activeTab === "security" && (
            <div className="space-y-8">
              {/* Password Section */}
              <div className="frame">
              <div className="frame-inner p-5 sm:p-8 space-y-8">
                <div>
                  <h2 className="text-[20px] font-heading font-semibold text-default-950 tracking-tight mb-1">
                    Change Password
                  </h2>
                  <p className="text-[14px] text-default-500 font-body">
                    Ensure your account is using a long, random password to stay
                    secure.
                  </p>
                </div>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <label htmlFor="settings-current-password" className="text-[13px] font-medium text-default-700 pl-1">
                      Current Password
                    </label>
                    <SecretInput
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      id="settings-current-password"
                      autoComplete="current-password"
                      disabled={saving}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label htmlFor="settings-new-password" className="text-[13px] font-medium text-default-700 pl-1">
                        New Password
                      </label>
                      <SecretInput
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        id="settings-new-password"
                        autoComplete="new-password"
                        revealLabel="new password"
                        disabled={saving}
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="settings-confirm-password" className="text-[13px] font-medium text-default-700 pl-1">
                        Confirm New Password
                      </label>
                      <SecretInput
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        id="settings-confirm-password"
                        autoComplete="new-password"
                        revealLabel="confirmation"
                        disabled={saving}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <ActionButton
                    onClick={handlePasswordChange}
                    disabled={saving}
                    variant="primary"
                    className="px-8 py-3"
                  >
                    {saving ? (
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <span className="flex items-center gap-2">
                        <Lock size={16} /> Update Password
                      </span>
                    )}
                  </ActionButton>
                </div>
              </div>
              </div>

              <TwoFactorSettings />

              {/* Danger Zone */}
              <div className="bg-white rounded-xl border border-accent-red/20 p-8 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-accent-red/10 rounded-xl">
                    <Trash2 className="text-accent-red" size={20} />
                  </div>
                  <h2 className="text-[18px] font-heading font-semibold text-default-950 tracking-tight">
                    Danger Zone
                  </h2>
                </div>
                <p className="text-[14px] text-default-500 mb-6 font-body leading-relaxed max-w-xl">
                  Delete your merchant account. Your wallets, API keys and payment
                  links stop working and your personal data is removed. Payment
                  records are kept for accounting. This can&apos;t be undone.
                </p>
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="bg-accent-red/5 text-accent-red hover:bg-accent-red hover:text-white border border-accent-red/20 font-semibold py-3 px-8 rounded-xl transition-all text-[13px] disabled:opacity-50 shadow-sm cursor-pointer"
                >
                  Delete Merchant Account
                </button>
              </div>
            </div>
          )}

          {activeTab === "webhooks" && <WebhookSettings />}

          {activeTab === "payments" && (
            <div className="frame">
            <div className="frame-inner p-5 sm:p-8 space-y-8">
              <div>
                <h2 className="text-[20px] font-heading font-semibold text-default-950 tracking-tight mb-1">
                  Payment Acceptance
                </h2>
                <p className="text-[14px] text-default-500 font-body">
                  Choose how much of the invoiced amount must arrive for a
                  payment to count as fully paid.
                </p>
              </div>

              <div className="space-y-4 max-w-xs">
                <label className="text-[13px] font-medium text-default-700 pl-1">
                  Underpaid Threshold
                </label>
                <div className="relative group">
                  <input
                    type="number"
                    min={95}
                    max={100}
                    step={1}
                    value={underpaidPercent}
                    onChange={(e) => setUnderpaidPercent(e.target.value)}
                    className="w-full bg-white border border-default-200 rounded-xl pl-4 pr-12 py-3.5 text-[14px] font-mono text-default-600 focus:outline-none focus:ring-4 focus:ring-sky/10 focus:border-sky transition-all"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-default-500">
                    <Percent size={18} />
                  </div>
                </div>
              </div>

              <div className="p-4 bg-default-50 border border-default-200 rounded-xl">
                <p className="text-[12px] text-default-500 flex items-start gap-2 leading-relaxed">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  Payments receiving at least this percentage of the expected
                  amount are accepted as paid; anything below is marked
                  underpaid. Allowed range is 95%–100%.
                </p>
              </div>

              <div className="pt-4 flex justify-end">
                <ActionButton
                  onClick={handlePaymentsSave}
                  disabled={saving}
                  variant="primary"
                  className="px-8 py-3"
                >
                  {saving ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <span className="flex items-center gap-2">
                      <Save size={16} /> Save Settings
                    </span>
                  )}
                </ActionButton>
              </div>
            </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
