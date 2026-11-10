import Link from "next/link";

import { AcceptInvitationForm } from "@/components/accept-invitation-form";

export default async function AcceptInvitationPage({
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
          <p className="eyebrow">Employee invitation</p>
          <h1>Join your team.</h1>
          <p>Create an account to accept your organization and store access.</p>
        </div>
        <p className="story-footnote">Invitation links expire after 72 hours.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">Create your account</p>
          <h2>Accept invitation</h2>
          <p className="form-intro">Your account will be linked to the email address that received this invitation.</p>
          {token
            ? <AcceptInvitationForm token={token} />
            : <p className="form-error" role="alert">This invitation link is invalid or expired. Ask the owner to send another invitation.</p>}
        </div>
      </section>
    </main>
  );
}
