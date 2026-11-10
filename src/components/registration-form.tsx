"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function RegistrationForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerName: formData.get("ownerName"),
          businessName: formData.get("businessName"),
          storeName: formData.get("storeName"),
          email: formData.get("email"),
          password: formData.get("password"),
        }),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(result.error ?? "We could not create the account.");
        return;
      }

      router.push("/login?registered=1");
    } catch {
      setError("The service could not be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="auth-form">
      <label>
        Your name
        <input autoComplete="name" name="ownerName" required minLength={2} maxLength={100} />
      </label>
      <label>
        Business name
        <input autoComplete="organization" name="businessName" required minLength={2} maxLength={120} />
      </label>
      <label>
        First store name
        <input name="storeName" required minLength={2} maxLength={120} />
      </label>
      <label>
        Business email
        <input autoComplete="email" name="email" type="email" required maxLength={254} />
      </label>
      <label>
        Password
        <input autoComplete="new-password" name="password" type="password" required minLength={12} maxLength={128} />
        <span className="field-hint">Use at least 12 characters.</span>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button-primary" type="submit" disabled={busy}>
        {busy ? "Creating workspace..." : "Create business account"}
      </button>
    </form>
  );
}
