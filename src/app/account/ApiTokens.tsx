"use client";

import { useCallback, useEffect, useState } from "react";

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Personal tokens for MCP over HTTP (`/api/mcp`). The secret is shown once. */
export function ApiTokens() {
  const [rows, setRows] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/account/tokens", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    setRows(res.ok ? (data.tokens ?? []) : []);
  }, []);
  useEffect(() => void load(), [load]);

  const call = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error === "TOKEN_LIMIT" ? "Не больше 10 активных токенов" : "Не получилось");
      return data;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
      void load();
    }
  };

  return (
    <div className="panel" data-testid="api-tokens">
      <h2>Токены MCP</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Для агента на другой машине: MCP по адресу <code>/api/mcp</code> с заголовком{" "}
        <code>Authorization: Bearer dga_…</code>. Токен действует от вашего имени.
      </p>
      <form
        className="row"
        style={{ gap: 8 }}
        onSubmit={(event) => {
          event.preventDefault();
          void call({ name: name.trim() }).then((data) => {
            if (data?.token) {
              setFresh(data.token);
              setName("");
            }
          });
        }}
      >
        <input
          className="input"
          placeholder="Название, например «ноутбук»"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
        <button className="btn" disabled={busy || !name.trim()}>
          Выпустить
        </button>
      </form>
      {fresh ? (
        <p data-testid="api-token-fresh" style={{ wordBreak: "break-all" }}>
          Скопируйте сейчас, второй раз он не покажется: <code>{fresh}</code>
        </p>
      ) : null}
      {error ? <div className="error">{error}</div> : null}
      {rows === null ? (
        <p className="muted">Загрузка…</p>
      ) : (
        rows.map((row) => (
          <div key={row.id} className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
            <span className={row.revokedAt ? "muted" : undefined}>
              {row.name} · {row.prefix}… ·{" "}
              {row.revokedAt
                ? "отозван"
                : row.lastUsedAt
                  ? `был в ходу ${new Date(row.lastUsedAt).toLocaleString("ru-RU")}`
                  : "не использовался"}
            </span>
            {row.revokedAt ? null : (
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Отозвать токен «${row.name}»?`)) void call({ revoke: row.id });
                }}
              >
                Отозвать
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
