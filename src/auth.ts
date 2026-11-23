import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import { bindIdentity, freshUser, kanameEnabled, recordActivity } from "@/server/kaname";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/lib/db";

import { provisionedAccountEmail } from "@/lib/domain/account-login";
import { verifyCredentials } from "@/server/accounts";

const credsSchema = z.object({
  email: z.string().trim()
    .transform((value) => process.env.PROVISIONED_ACCOUNTS_ONLY === "1" ? provisionedAccountEmail(value) : value)
    .pipe(z.string().email()),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: kanameEnabled() ? [Keycloak({
    issuer: process.env.KANAME_OIDC_ISSUER,
    clientId: process.env.KANAME_OIDC_CLIENT_ID,
    clientSecret: process.env.KANAME_OIDC_CLIENT_SECRET,
    checks: ["pkce", "state", "nonce"],
  })] : [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        const parsed = credsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        // Case-insensitive lookup, password check and ADMIN_EMAILS bootstrap.
        const user = await verifyCredentials(email, password);
        if (!user) return null;
        return { id: user.id, email: user.email };
      },
    }),
  ],
  events: {
    async signOut(event) {
      if ("token" in event && typeof event.token?.kanameSession === "string")
        await prisma.kanameSession.deleteMany({ where: { id: event.token.kanameSession } });
    },
  },
  callbacks: {
    async jwt({ token, user, account, profile }) {
      if (kanameEnabled() && user) {
        if (account?.provider !== "keycloak" || !profile?.sub || profile.iss !== process.env.KANAME_OIDC_ISSUER)
          return null;
        const id = await bindIdentity(profile.sub);
        const session = await prisma.kanameSession.create({ data: { userId: id, expires: new Date(Date.now() + 30 * 86400000) } });
        token.id = id;
        token.kanameSession = session.id;
        return token;
      }
      if (user) token.id = (user as { id: string }).id;
      return token;
    },
    async session({ session, token }) {
      if (kanameEnabled()) {
        const sid = typeof token.kanameSession === "string" ? token.kanameSession : "";
        const row = sid && await prisma.kanameSession.findUnique({ where: { id: sid } });
        if (!row || row.expires <= new Date() || row.userId !== token.id) return { ...session, user: { ...session.user, id: "" } };
      }
      if (token.id && session.user) {
        (session.user as { id: string }).id = token.id as string;
      }
      return session;
    },
  },
});

export interface SessionUser {
  id: string;
  email: string;
  role: string;
}

/**
 * Resolve the current user with a FRESH role from the DB (the JWT only
 * carries the id). A role change by an admin therefore applies on the very
 * next request, without re-login. Throws if unauthenticated.
 */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) throw new Error("UNAUTHENTICATED");
  const user = await freshUser(id);
  return { id: user.id, email: user.email, role: user.role };
}

/** Resolve the current user id, or throw if unauthenticated. */
export async function requireUserId(): Promise<string> {
  return (await requireUser()).id;
}

/** Like requireUser, but returns null instead of throwing (for pages). */
export async function currentUser(): Promise<SessionUser | null> {
  try {
    const user = await requireUser();
    await recordActivity(user.id);
    return user;
  } catch {
    return null;
  }
}
