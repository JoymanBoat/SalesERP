import { redirect } from "next/navigation";
import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";
import { auth } from "@/auth";

export default async function StoreAccessPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="store-access-page">
      <section className="data-panel">
        <p className="eyebrow">Store access</p>
        <h1>No active store is assigned to your account</h1>
        <p>Ask an organization owner to assign you to at least one active store. After that, return to your workspace to continue.</p>
        <Link className="customer-filter-link" href="/dashboard">Return to workspace</Link>
        <SignOutButton />
      </section>
    </main>
  );
}
