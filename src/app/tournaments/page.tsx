import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { formatBytes, quotasFor } from "@/lib/domain/permissions";
import { listTournaments } from "@/server/tournaments";
import { CreateTournamentForm } from "./CreateTournamentForm";
import { DeleteTournamentButton } from "./DeleteTournamentButton";
import { SCHEME_INFO } from "@/lib/domain/scheme-settings";
import { isScheme } from "@/lib/domain/types";
import { pluralRu } from "@/lib/domain/art-usage";
const STATUS_LABEL: Record<string, string> = {
  draft: "Черновик",
  in_progress: "В процессе",
  completed: "Завершён",
};

export default async function TournamentsPage() {
  const user = await currentUser();
  if (!user) redirect("/");
  const tournaments = await listTournaments(user.id);
  const quotas = quotasFor(user.role);

  return (
    <div className="container">
      <h1>Мои топы</h1>
      <CreateTournamentForm
        limits={{
          archiveLimitLabel: formatBytes(quotas.maxArchiveBytes),
          slotsLeft:
            quotas.maxTournaments === null
              ? null
              : quotas.maxTournaments - tournaments.length,
        }}
      />

      <div className="panel">
        <h2>Список турниров</h2>
        {tournaments.length === 0 ? (
          <p className="muted">
            Пока нет ни одного турнира. Создайте первый выше.
          </p>
        ) : (
          tournaments.map((t) => (
            <div className="list-item" key={t.id}>
              <div>
                <a
                  href={`/tournaments/${t.id}`}
                  style={{ fontWeight: 600, fontSize: 16 }}
                >
                  {t.title}
                </a>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                  {t.schemePending
                    ? "Алгоритм не выбран"
                    : isScheme(t.scheme)
                      ? SCHEME_INFO[t.scheme].label
                      : t.scheme}{" "}
                  · {t._count.tracks} {pluralRu(t._count.tracks, ["участник", "участника", "участников"])} ·{" "}
                  {(() => {
                    // Old pair-only tournaments have answers without batches.
                    const answers = t._count.batches || t._count.comparisons;
                    return `${answers} ${pluralRu(answers, ["ответ", "ответа", "ответов"])}`;
                  })()}
                </div>
              </div>
              <div className="row" style={{ gap: 12 }}>
                <span className="tag">
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
                <DeleteTournamentButton id={t.id} title={t.title} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
