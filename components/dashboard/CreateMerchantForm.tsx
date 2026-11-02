"use client";

import { reservedEmailRefusal, reservedNameRefusal } from "@/lib/reserved-names";
import { SecretInput } from "@/components/ui/SecretInput";
import { toast } from "@/lib/toast";
import { isStrongPassword, passwordErrorMessage } from "@/lib/validation";
import { AlertCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const inputClass =
  "w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] font-medium text-default-800 focus:outline-none focus:ring-4 focus:ring-sky/10 focus:border-sky transition-all";
const labelClass =
  "text-[13px] font-medium text-default-700 pl-1";

export function CreateMerchantForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"merchant" | "admin">("merchant");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const refusal = reservedNameRefusal(name, role) ?? reservedEmailRefusal(email, role);
    if (refusal) {
      setError(refusal);
      return;
    }
    if (!isStrongPassword(password)) {
      setError(passwordErrorMessage);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/merchants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role, ...(role === "admin" ? { adminPassword } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not create the account.");
        return;
      }
      toast.success("Account created", `${name} can sign in at ${email}.`);
      router.push(`/merchants/${data.id}`);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="frame">
    <div
      onSubmit={submit}
      className="frame-inner p-5 sm:p-8 space-y-6"
    >
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[18px] font-heading font-semibold text-default-950">
            New account
          </h2>
          <p className="text-[13px] text-default-500 mt-1">
            The email is treated as verified. Share the password with its owner
            securely; they sign in with an email code until they set up an
            authenticator.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-default-500 hover:text-default-900 cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>

      {error && (
        <p className="flex items-center gap-2 text-[13px] text-accent-red font-medium">
          <AlertCircle size={14} /> {error}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className={labelClass}>Company Name</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>
        <div className="space-y-2">
          <label className={labelClass}>Email</label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="space-y-2">
          <label className={labelClass}>Initial Password</label>
          <input
            required
            type="text"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </div>
        <div className="space-y-2">
          <label className={labelClass}>Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className={`${inputClass} cursor-pointer`}
          >
            <option value="merchant">Merchant</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {role === "admin" && (
          <div className="space-y-2 md:col-span-2">
            <label className={labelClass}>Your Password</label>
            <SecretInput
              required
              autoComplete="current-password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className={inputClass}
            />
            <p className="text-[12px] text-default-500 pl-1">
              Granting admin access asks for your password. Every admin is emailed.
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="px-6 py-3 bg-primary text-white rounded-xl text-[13px] font-semibold hover:bg-primary-deep disabled:opacity-50 cursor-pointer"
        >
          {busy ? "Creating…" : "Create account"}
        </button>
      </div>
    </div>
    </form>
  );
}
