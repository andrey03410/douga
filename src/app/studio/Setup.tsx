export function StudioSetup({ email }: { email: string }) {
  return (
    <details className="panel">
      <summary>Внешний MCP и запуск worker</summary>
      <p>
        Собирайте видео во внешнем MCP-клиенте или редактируйте канонический
        JSON в SDK. Встроенного чата нет.
      </p>
      <p>
        Доверенный <code>MCP_ACTOR_EMAIL</code> должен совпадать с владельцем
        веб-аккаунта: <strong>{email}</strong>. Настройте это в окружении
        MCP-процесса; проекты другого аккаунта здесь не появятся.
      </p>
      <pre className="studio-code">
        {JSON.stringify(
          {
            mcpServers: {
              douga: {
                command: "npm",
                args: ["run", "--silent", "mcp"],
                cwd: "/absolute/path/to/douga",
                env: { MCP_ACTOR_EMAIL: email },
              },
            },
          },
          null,
          2,
        )}
      </pre>
      <p>Примеры запросов внешнему клиенту:</p>
      <pre className="studio-code">{`video_project_list({})\nvideo_preset_list({})\nvideo_document_get({ projectId: "…", section: "head" })`}</pre>
      <p>
        Тяжёлые задания выполняет отдельный процесс. Откройте терминал в папке
        проекта и запустите:
      </p>
      <pre className="studio-code">npm run studio:worker</pre>
      <p className="muted">
        Веб-запрос ставит задание в устойчивую очередь. Сохранение кода и
        изменение рейтинга сами не запускают рендер. Финальный MP4 доступен
        администратору.
      </p>
    </details>
  );
}
