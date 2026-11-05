"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteTournamentButton({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (!confirm(`Удалить турнир «${title}»? Это действие необратимо.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tournaments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Ошибка удаления");
      router.refresh();
    } catch {
      setBusy(false);
      alert("Не удалось удалить турнир");
    }
  }

  return (
    <button
      className="btn ghost"
      onClick={onDelete}
      disabled={busy}
      title="Удалить турнир"
      style={{ padding: "6px 12px" }}
    >
      {busy ? "…" : "🗑 Удалить"}
    </button>
  );
}
