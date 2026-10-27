import { findUserByEmail } from "@/server/accounts";

// The MCP server acts on behalf of exactly one account, identified by
// MCP_ACTOR_EMAIL. All tool calls run with this user's id, role and quotas.
export interface Actor {
  userId: string;
  email: string;
  role: string;
}

export async function resolveActor(): Promise<Actor> {
  const email = process.env.MCP_ACTOR_EMAIL?.trim();
  if (!email) {
    throw new Error(
      "MCP_ACTOR_EMAIL не задан — укажите email аккаунта, от имени которого работает MCP-сервер",
    );
  }
  // Same case-insensitive lookup as the web login.
  const user = await findUserByEmail(email);
  if (!user) {
    throw new Error(`Аккаунт для MCP_ACTOR_EMAIL="${email}" не найден — сначала зарегистрируйте его в приложении`);
  }
  return { userId: user.id, email: user.email, role: user.role };
}
