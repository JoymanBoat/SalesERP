"use client";

import { useState } from "react";

export function EmailVerificationForm({ token }: { token?: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(formData: FormData) {
    setMessage("");
    setError("");
    setBusy(true);
    try {
      const response = await fetch(token ? "/api/auth/email-verification" : "/api/auth/email-verification/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(token ? { token } : { email: formData.get("email") }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) {
        setError(result.error ?? "The request could not be completed.");
        return;
      }
      setMessage(result.message ?? "Done.");
      setDone(true);
    } catch {
      setError("The service could not be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="auth-form">
      {!token && (
        <label>
          Email address
          <input autoComplete="email" name="email" type="email" required maxLength={254} />
        </label>
      )}
      {message && <p className="form-success" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!(token && done) && (
        <button className="button-primary" type="submit" disabled={busy}>
          {busy ? "Working..." : token ? "Verify my email" : "Send verification link"}
        </button>
      )}
    </form>
  );
}
