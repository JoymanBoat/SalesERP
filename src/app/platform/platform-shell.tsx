import { Building2, ClipboardList, Layers3, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";

import "./platform.css";

export function PlatformShell({ active, children }: { active: "businesses" | "audit" | "packages"; children: React.ReactNode }) {
  return (
    <div className="platform-shell">
      <aside className="platform-sidebar">
        <Link href="/platform" className="platform-brand">
          <span className="platform-brand-mark">K</span>
          <span>Keta Retail<small>PLATFORM ADMIN</small></span>
        </Link>
        <p className="platform-nav-label">WORKSPACE</p>
        <nav className="platform-nav" aria-label="Platform administration">
          <Link href="/platform" className={active === "businesses" ? "is-active" : undefined} aria-current={active === "businesses" ? "page" : undefined}>
            <Building2 size={18} aria-hidden="true" /> Businesses
          </Link>
          <Link href="/platform/packages" className={active === "packages" ? "is-active" : undefined} aria-current={active === "packages" ? "page" : undefined}>
            <Layers3 size={18} aria-hidden="true" /> Packages
          </Link>
          <Link href="/platform/audit" className={active === "audit" ? "is-active" : undefined} aria-current={active === "audit" ? "page" : undefined}>
            <ClipboardList size={18} aria-hidden="true" /> Audit log
          </Link>
        </nav>
        <div className="platform-sidebar-bottom">
          <div className="platform-security"><ShieldCheck size={18} aria-hidden="true" /><span><strong>Protected access</strong><small>Platform activity is audited</small></span></div>
          <SignOutButton />
        </div>
      </aside>
      <main className="platform-main">{children}</main>
    </div>
  );
}
