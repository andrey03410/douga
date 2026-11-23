import { effectiveLimit, freshUser, kanameEnv } from "@/server/kaname";
import { usageForSubject } from "@/server/kaname-usage";

export async function KanameUsage({ userId }: { userId: string }) {
  const { grant } = await freshUser(userId);
  if (!grant) return null;
  const { storageBytes, counts } = await usageForSubject(grant.subject);
  const number = (n: number) => n.toLocaleString("ru-RU");
  const used = (n: number, cap: number | null) => cap === null ? number(n) : `${number(n)} из ${number(cap)}`;
  return <section className="panel"><h2>Мои лимиты Douga</h2>
    <p>Хранилище · {used(storageBytes, effectiveLimit(grant, "storageBytes"))} байт</p>
    <p>Проекты · {used(counts.projects, effectiveLimit(grant, "projects"))}</p>
    <p>HTML-публикации · {used(counts.publications, effectiveLimit(grant, "publications"))}</p>
    <a href={kanameEnv("KANAME_PUBLIC_URL")}>Общий кабинет Kaname</a>
  </section>;
}
