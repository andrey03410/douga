import "./globals.css";
import type { Metadata } from "next";
import { currentUser, signOut } from "@/auth";
import { can } from "@/lib/domain/permissions";
import { Logo } from "./components/Logo";

export const metadata: Metadata = {
  title: "Douga",
  description: "Генератор аниме-видео: топы, турниры и пикеры",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  return (
    <html lang="ru">
      <body>
        <div className="topbar">
          <div className="row" style={{ gap: 18 }}>
            <a className="brand" href="/" aria-label="Douga — на главную">
              <Logo />
            </a>
            {user ? (
              <nav className="row" style={{ gap: 14 }}>
                <a href="/projects">Мои видео</a>
                <a href="/tournaments">Мои топы</a>
                <a href="/account">Личный кабинет</a>
                {can(user.role, "admin:users") ? <a href="/admin">Админка</a> : null}
              </nav>
            ) : null}
          </div>
          {user ? (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <div className="row">
                <span className="muted">{user.email}</span>
                <button className="btn ghost" type="submit">
                  Выйти
                </button>
              </div>
            </form>
          ) : (
            <a className="btn ghost" href="/login">
              Войти
            </a>
          )}
        </div>
        {children}
      </body>
    </html>
  );
}
