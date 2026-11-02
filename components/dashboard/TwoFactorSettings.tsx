"use client";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { apiRequest } from "@/lib/api-client";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { KeyRound, Mail, ShieldCheck, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { ActionButton } from "./ActionButton";

type Method = "email" | "totp";

interface Status {
  method: Method;
  authenticatorAvailable: boolean;
}

const inputClass =
  "w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] font-mono text-default-600 focus:outline-none focus:ring-4 focus:ring-sky/10 focus:border-sky transition-all";
const labelClass =
  "text-[13px] font-medium text-default-700 pl-1";

export function TwoFactorSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  const load = () => {
    setLoadFailed(false);
    fetch("/api/merchants/two-factor")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setStatus)
      .catch(() => setLoadFailed(true));
  };
  useEffect(load, []);

  const reset = () => {
    setSetup(null);
    setDisabling(false);
    setCode("");
    setPassword("");
  };

  const send = async (method: "POST" | "DELETE", body: object, loading: string, success: string) => {
    setBusy(true);
    try {
      return await toast.promise(
        apiRequest<Record<string, string>>("/api/merchants/two-factor", { method, body }),
        { loading, success, error: "Two-factor settings not changed" },
      );
    } catch {
      return null;
    } finally {
      setBusy(false);
    }
  };

  const startSetup = async () => {
    setBusy(true);
    try {
      setSetup(
        await apiRequest<{ secret: string; uri: string }>("/api/merchants/two-factor", {
          method: "POST",
          body: { action: "setup" },
        }),
      );
    } catch (error) {
      toast.error("Couldn't start setup", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async () => {
    const data = await send(
      "POST",
      { action: "enable", code, password },
      "Checking the code…",
      "Authenticator enabled: use it at your next sign-in",
    );
    if (!data) return;
    reset();
    setStatus((s) => s && { ...s, method: "totp" });
  };

  const confirmDisable = async () => {
    const ok = await confirm({
      title: "Switch to email codes?",
      description: "Your authenticator app stops working for this account. Sign-in codes will be emailed to you instead.",
      confirmLabel: "Use email codes",
    });
    if (!ok) return;
    const data = await send("DELETE", { code, password }, "Switching…", "Sign-in codes will arrive by email");
    if (!data) return;
    reset();
    setStatus((s) => s && { ...s, method: "email" });
  };

  const methods: { id: Method; label: string; hint: string; icon: typeof Mail }[] = [
    { id: "email", label: "Email code", hint: "A code is emailed when a sign-in needs one.", icon: Mail },
    {
      id: "totp",
      label: "Authenticator app",
      hint: "Google Authenticator, 1Password, Authy or similar.",
      icon: Smartphone,
    },
  ];

  return (
    <div className="frame">
    <div className="frame-inner p-5 sm:p-8 space-y-8">
      <div>
        <h2 className="text-[20px] font-heading font-semibold text-default-950 tracking-tight mb-1">
          Two-Factor Authentication
        </h2>
        <p className="text-[14px] text-default-500 font-body">
          Choose how you confirm a sign-in after your password, on a new or unremembered device or from somewhere unusual.
        </p>
      </div>

      {loadFailed && (
        <div className="flex items-center justify-between p-4 bg-accent-red/5 border border-accent-red/10 rounded-xl text-[13px] text-accent-red font-medium">
          Couldn&apos;t load your two-factor settings.
          <button onClick={load} className="font-semibold underline cursor-pointer">
            Try again
          </button>
        </div>
      )}

      {status && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {methods.map((m) => {
            const active = status.method === m.id;
            return (
              <div
                key={m.id}
                className={cn(
                  "p-5 rounded-xl border flex items-start gap-4",
                  active ? "border-sky bg-sky/5" : "border-default-200",
                )}
              >
                <m.icon size={20} className={active ? "text-sky" : "text-default-400"} />
                <div className="flex-1">
                  <p className="text-[14px] font-semibold text-default-900 flex items-center gap-2">
                    {m.label}
                    {active && (
                      <span className="text-[10px] uppercase tracking-wider text-sky">
                        In use
                      </span>
                    )}
                  </p>
                  <p className="text-[12px] text-default-500 mt-1">{m.hint}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {status?.method === "email" && !setup && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <p className="text-[13px] text-default-500">
            {status.authenticatorAvailable
              ? "Switch to an authenticator app to sign in without waiting for an email."
              : "Authenticator apps aren't available on this server yet."}
          </p>
          <ActionButton
            onClick={startSetup}
            disabled={busy || !status.authenticatorAvailable}
            variant="primary"
            className="px-6 py-3 shrink-0"
          >
            <span className="flex items-center gap-2">
              <Smartphone size={16} /> Set up authenticator
            </span>
          </ActionButton>
        </div>
      )}

      {setup && (
        <div className="space-y-6 border-t border-default-100 pt-6">
          <div className="flex flex-col md:flex-row gap-6 items-start">
            <div className="p-3 bg-white border border-default-200 rounded-xl shrink-0">
              <QRCodeSVG value={setup.uri} size={160} level="M" />
            </div>
            <div className="space-y-3 text-[13px] text-default-600">
              <p>1. Scan this QR code with your authenticator app.</p>
              <p>Can&apos;t scan it? Enter this key manually:</p>
              <code className="block p-3 bg-default-50 border border-default-200 rounded-lg font-mono text-[13px] break-all select-all">
                {setup.secret}
              </code>
              <p>2. Enter the 6-digit code it shows, and your password.</p>
            </div>
          </div>
          <CodeAndPassword
            code={code}
            password={password}
            onCode={setCode}
            onPassword={setPassword}
            disabled={busy}
          />
          <div className="flex justify-end gap-3">
            <button
              onClick={reset}
              className="px-6 py-3 text-[13px] font-semibold text-default-500 hover:text-default-900 cursor-pointer"
            >
              Cancel
            </button>
            <ActionButton
              onClick={confirmSetup}
              disabled={busy || code.length !== 6 || !password}
              variant="primary"
              className="px-6 py-3"
            >
              <span className="flex items-center gap-2">
                <ShieldCheck size={16} /> Enable authenticator
              </span>
            </ActionButton>
          </div>
        </div>
      )}

      {status?.method === "totp" && !disabling && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <p className="text-[13px] text-default-500">
            Lost your device? An administrator can reset your account to email codes.
          </p>
          <button
            onClick={() => setDisabling(true)}
            className="px-6 py-3 rounded-xl border border-default-200 text-[13px] font-semibold text-default-600 hover:text-default-950 hover:border-default-300 cursor-pointer shrink-0"
          >
            Switch to email codes
          </button>
        </div>
      )}

      {disabling && (
        <div className="space-y-6 border-t border-default-100 pt-6">
          <p className="text-[13px] text-default-600">
            Confirm with a current code from your authenticator app and your password.
          </p>
          <CodeAndPassword
            code={code}
            password={password}
            onCode={setCode}
            onPassword={setPassword}
            disabled={busy}
          />
          <div className="flex justify-end gap-3">
            <button
              onClick={reset}
              className="px-6 py-3 text-[13px] font-semibold text-default-500 hover:text-default-900 cursor-pointer"
            >
              Cancel
            </button>
            <ActionButton
              onClick={confirmDisable}
              disabled={busy || code.length !== 6 || !password}
              variant="primary"
              className="px-6 py-3"
            >
              <span className="flex items-center gap-2">
                <KeyRound size={16} /> Use email codes
              </span>
            </ActionButton>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

function CodeAndPassword(props: {
  code: string;
  password: string;
  onCode: (v: string) => void;
  onPassword: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="space-y-2">
        <label className={labelClass}>Authenticator Code</label>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={props.code}
          onChange={(e) => props.onCode(e.target.value.replace(/\D/g, ""))}
          placeholder="000000"
          className={cn(inputClass, "tracking-[0.3em]")}
          disabled={props.disabled}
        />
      </div>
      <div className="space-y-2">
        <label className={labelClass}>Current Password</label>
        <input
          type="password"
          autoComplete="current-password"
          value={props.password}
          onChange={(e) => props.onPassword(e.target.value)}
          className={inputClass}
          disabled={props.disabled}
        />
      </div>
    </div>
  );
}
