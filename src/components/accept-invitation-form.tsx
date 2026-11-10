"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AcceptInvitationForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(formData: FormData) {
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name: formData.get("name"),
          password: formData.get("password"),
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "The invitation could not be accepted.");
        return;
      }
      router.push("/login?invited=1");
    } catch {
      setError("The service could not be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="auth-form">
      <label>
        Your name
        <input autoComplete="name" name="name" required minLength={2} maxLength={100} />
      </label>
      <label>
        Create a password
        <input autoComplete="new-password" name="password" type="password" required minLength={12} maxLength={128} />
        <span className="field-hint">Use at least 12 characters.</span>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button-primary" type="submit" disabled={busy}>
        {busy ? "Creating account..." : "Accept invitation"}
      </button>
    </form>
  );
}
