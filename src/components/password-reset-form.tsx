"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function PasswordResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(formData: FormData) {
    setError("");
    const password = String(formData.get("password") ?? "");
    if (password !== formData.get("confirmPassword")) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "The password could not be updated.");
        return;
      }
      router.push("/login?reset=1");
    } catch {
      setError("The service could not be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="auth-form">
      <label>
        New password
        <input autoComplete="new-password" name="password" type="password" required minLength={12} maxLength={128} />
        <span className="field-hint">Use at least 12 characters.</span>
      </label>
      <label>
        Confirm new password
        <input autoComplete="new-password" name="confirmPassword" type="password" required minLength={12} maxLength={128} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button-primary" type="submit" disabled={busy}>
        {busy ? "Updating password..." : "Update password"}
      </button>
      <p className="form-switch"><Link href="/forgot-password">Request another link</Link></p>
    </form>
  );
}
