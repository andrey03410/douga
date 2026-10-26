import { expect, it } from "vitest";
import { poolBulkDeleteOutcome } from "./bulk-delete";
it("keeps successful deletions and per-file protected guidance on a 409 partial response", () => {
  const outcome = poolBulkDeleteOutcome(409, {
    deleted: ["removed"],
    failed: [
      {
        id: "protected",
        reason: "STUDIO_ASSET_IN_USE",
        message: "Освободите историю",
      },
    ],
  });
  expect(outcome.deleted).toEqual(["removed"]);
  expect(outcome.failedIds).toEqual(["protected"]);
  expect(outcome.error).toContain("protected: Освободите историю");
});
it("does not treat a failed request as a successful cleanup", () => {
  expect(poolBulkDeleteOutcome(500, { error: "Не удалось удалить" })).toEqual({
    deleted: [],
    failedIds: [],
    error: "Не удалось удалить",
  });
});
