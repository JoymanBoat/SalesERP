"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm({ registered = false }: { registered?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(formData: FormData) {
    setError("");
    setBusy(true);
    // Form actions reset the form afterwards; keeping the email as the default value preserves it after a failed attempt.
    setEmail(String(formData.get("email") ?? ""));

    try {
      const result = await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirect: false,
      });

      if (result?.error) {
        setError("The email or password is incorrect.");
        return;
      }

      router.push("/");
    } catch {
      setError("We could not sign you in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="auth-form">
      {registered && <p className="form-success" role="status">Your business account is ready. Sign in to continue.</p>}
      <label>
        Email address
        <input autoComplete="email" name="email" type="email" required maxLength={254} defaultValue={email} key={email} />
      </label>
      <label>
        Password
        <input autoComplete="current-password" name="password" type="password" required minLength={12} maxLength={128} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button-primary" type="submit" disabled={busy}>
        {busy ? "Signing in..." : "Sign in"}
      </button>
      <p className="form-switch"><Link href="/forgot-password">Forgot your password?</Link></p>
    </form>
  );
}
