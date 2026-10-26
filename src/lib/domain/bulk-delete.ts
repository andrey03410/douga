/** A mixed cleanup can return 409 while already deleting unprotected entries. */
export function poolBulkDeleteOutcome(
  status: number,
  raw: unknown,
): { deleted: string[]; failedIds: string[]; error: string | null } {
  const body = (raw && typeof raw === "object" ? raw : {}) as {
    deleted?: unknown;
    failed?: unknown;
    error?: unknown;
  };
  if (
    ((status >= 200 && status < 300) || status === 409) &&
    Array.isArray(body.deleted) &&
    Array.isArray(body.failed)
  ) {
    const failed = body.failed as {
      id: string;
      reason?: string;
      message?: string;
    }[];
    return {
      deleted: body.deleted.filter(
        (id): id is string => typeof id === "string",
      ),
      failedIds: failed.map((f) => f.id),
      error: failed.length
        ? failed
            .map(
              (f) =>
                `${f.id}: ${f.message ?? f.reason ?? "Не удалось удалить"}`,
            )
            .join("; ")
        : null,
    };
  }
  return {
    deleted: [],
    failedIds: [],
    error: typeof body.error === "string" ? body.error : "Не удалось удалить",
  };
}
