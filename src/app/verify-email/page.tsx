import Link from "next/link";

import { EmailVerificationForm } from "@/components/email-verification-form";

export default async function VerifyEmailPage({
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
          <p className="eyebrow">Account security</p>
          <h1>Confirm your email address.</h1>
          <p>Verified addresses let owners grant you access to a business directly.</p>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">Email verification</p>
          <h2>{token ? "Verify your email" : "Request a verification link"}</h2>
          <p className="form-intro">{token ? "Confirm to finish verifying this address." : "Enter your account email and we will send a new link."}</p>
          <EmailVerificationForm token={token} />
          <p className="form-switch"><Link href="/login">Back to sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
