import Link from "next/link";

import { PasswordResetRequestForm } from "@/components/password-reset-request-form";

export default function ForgotPasswordPage() {
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Link className="brand-lockup" href="/">
          <span className="brand-symbol">K</span>
          <span>Keta<span className="brand-light">Retail</span></span>
        </Link>
        <div className="auth-message">
          <p className="eyebrow">Account recovery</p>
          <h1>Get back to business.</h1>
          <p>Request a secure, time-limited password-reset link.</p>
        </div>
        <p className="story-footnote">Reset links expire after 30 minutes.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">Password reset</p>
          <h2>Reset your password</h2>
          <p className="form-intro">If an account exists for the email, we will send a reset link.</p>
          <PasswordResetRequestForm />
          <p className="form-switch"><Link href="/login">Back to sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
