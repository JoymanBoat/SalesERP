import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { isLoginBlocked, recordLoginFailure, clearLoginFailures } from "@/lib/login-throttle";
import { prisma } from "@/lib/prisma";
import { credentialsSchema } from "@/lib/validation";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const email = parsed.data.email.toLowerCase();
        if (isLoginBlocked(email)) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
          recordLoginFailure(email);
          return null;
        }
        clearLoginFailures(email);
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sessionVersion = user.sessionVersion;
      if (token.sub && typeof token.sessionVersion === "number") {
        const currentUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { sessionVersion: true },
        });
        token.revoked = !currentUser || currentUser.sessionVersion !== token.sessionVersion;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.sessionVersion = typeof token.sessionVersion === "number" ? token.sessionVersion : 0;
      }
      session.revoked = token.revoked === true;
      return session;
    },
  },
});
