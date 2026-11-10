"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button className="button-quiet" onClick={() => signOut({ redirectTo: "/login" })} type="button">
      Sign out
    </button>
  );
}
