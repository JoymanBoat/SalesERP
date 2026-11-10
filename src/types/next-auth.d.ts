import "next-auth";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    revoked?: boolean;
    user: {
      id: string;
      sessionVersion: number;
    } & NonNullable<DefaultSession["user"]>;
  }

  interface User {
    sessionVersion: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sessionVersion?: number;
    revoked?: boolean;
  }
}
