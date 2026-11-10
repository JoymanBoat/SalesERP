"use client";

import { useState } from "react";

export function PasswordResetRequestForm() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(formData: FormData) {
    setMessage("");
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.get("email") }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) {
        setError(result.error ?? "The request could not be completed.");
        return;
      }
      setMessage(result.message ?? "If an account exists, a reset link will be sent.");
    } catch {
      setError("The service could not be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="auth-form">
      <label>
        Email address
        <input autoComplete="email" name="email" type="email" required maxLength={254} />
      </label>
      {message && <p className="form-success" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button-primary" type="submit" disabled={busy}>
        {busy ? "Requesting link..." : "Send password-reset link"}
      </button>
    </form>
  );
}
