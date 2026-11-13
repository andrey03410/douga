import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { roleLabel } from "@/lib/domain/permissions";
import { AccountManager } from "./AccountManager";
import { ApiTokens } from "./ApiTokens";

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/");

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Личный кабинет</h1>
        <span className="tag">{roleLabel(user.role)}</span>
      </div>
      <AccountManager />
      <ApiTokens />
    </div>
  );
}
