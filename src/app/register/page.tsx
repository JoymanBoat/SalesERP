import { redirect } from "next/navigation";
import Link from "next/link";

import { auth } from "@/auth";
import { RegistrationForm } from "@/components/registration-form";
import { SignOutButton } from "@/components/sign-out-button";
import { hasWorkspaceMembership } from "@/lib/workspace";

export default async function RegisterPage() {
  const session = await auth();
  const hasWorkspace = session?.user?.id ? await hasWorkspaceMembership(session.user.id) : false;
  if (hasWorkspace) redirect("/dashboard");

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Link className="brand-lockup" href="/">
          <span className="brand-symbol">K</span>
          <span>Keta<span className="brand-light">Retail</span></span>
        </Link>
        <div className="auth-message">
          <p className="eyebrow">Your business, in sync</p>
          <h1>Set up your retail workspace.</h1>
          <p>Start with your business and first store. You can add your team and inventory as you grow.</p>
        </div>
        <p className="story-footnote">Prices and reporting are configured in Ghana cedis.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">Get started</p>
          <h2>Create your business account</h2>
          <p className="form-intro">Your first store and owner account are created together.</p>
          {session?.user && !hasWorkspace && (
            <div className="form-notice">
              <p>Your current sign-in has no workspace. Sign out before using a different account.</p>
              <SignOutButton />
            </div>
          )}
          <RegistrationForm />
          <p className="form-switch">Already set up? <Link href="/login">Sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
