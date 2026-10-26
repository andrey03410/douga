/** Persist computed ranks/current N before any consumer reads the source. */
export async function finalizeResultsBeforeNavigation(
  id: string,
  topSize: number,
  navigate: () => void | Promise<void>,
) {
  const response = await fetch(`/api/tournaments/${id}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topSize }),
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(data.error ?? "Не удалось сохранить результаты");
  await navigate();
}
