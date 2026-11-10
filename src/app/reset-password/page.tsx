import Link from "next/link";

import { PasswordResetForm } from "@/components/password-reset-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Link className="brand-lockup" href="/">
          <span className="brand-symbol">K</span>
          <span>Keta<span className="brand-light">Retail</span></span>
        </Link>
        <div className="auth-message">
          <p className="eyebrow">Account recovery</p>
          <h1>Choose a new password.</h1>
          <p>Other signed-in sessions will be revoked after the password changes.</p>
        </div>
        <p className="story-footnote">Passwords must contain at least 12 characters.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">Password reset</p>
          <h2>Set a new password</h2>
          <p className="form-intro">Your reset link can only be used once.</p>
          {token
            ? <PasswordResetForm token={token} />
            : <p className="form-error" role="alert">This password-reset link is invalid or expired. Request a new link.</p>}
          {!token && <p className="form-switch"><Link href="/forgot-password">Request another link</Link></p>}
        </div>
      </section>
    </main>
  );
}
