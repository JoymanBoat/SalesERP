import { redirect } from "next/navigation";
import Link from "next/link";

import { auth } from "@/auth";
import { LoginForm } from "@/components/login-form";
import { SignOutButton } from "@/components/sign-out-button";
import { hasWorkspaceMembership } from "@/lib/workspace";
import { isPlatformAdmin } from "@/lib/platform-admin";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string; reset?: string; revoked?: string; invited?: string }>;
}) {
  const session = await auth();
  if (session?.user?.id && !session.revoked && await isPlatformAdmin(session.user.id)) redirect("/platform");
  const hasWorkspace = session?.user?.id && !session.revoked
    ? await hasWorkspaceMembership(session.user.id)
    : false;
  if (hasWorkspace) redirect("/dashboard");
  const { registered, reset, revoked, invited } = await searchParams;

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Link className="brand-lockup" href="/">
          <span className="brand-symbol">K</span>
          <span>Keta<span className="brand-light">Retail</span></span>
        </Link>
        <div className="auth-message">
          <p className="eyebrow">Retail, made clearer</p>
          <h1>Good business starts with a better view.</h1>
          <p>Sales, stock, and store operations in one calm, connected workspace.</p>
        </div>
        <p className="story-footnote">Designed for the way Ghanaian retailers work.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">Welcome back</p>
          <h2>Sign in to your store</h2>
          <p className="form-intro">Use your business account credentials to continue.</p>
          {reset === "1" && <p className="form-success" role="status">Your password has been updated. Sign in with your new password.</p>}
          {invited === "1" && <p className="form-success" role="status">Your invitation was accepted. Sign in to open your workspace.</p>}
          {revoked === "1" && <p className="form-notice" role="status">Your previous session was revoked. Sign in again to continue.</p>}
          {session?.user && !hasWorkspace && (
            <div className="form-notice">
              <p>Your current sign-in has no workspace. Sign out before using a different account.</p>
              <SignOutButton />
            </div>
          )}
          <LoginForm registered={registered === "1"} />
          <p className="form-switch">New to Keta Retail? <Link href="/register">Create a business account</Link></p>
        </div>
      </section>
    </main>
  );
}
