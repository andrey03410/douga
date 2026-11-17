import { resourceBudgetDiagnostic } from "@douga/video/resource-limits";

/** The stored JSON and raw draft text share one UTF-8 byte budget. */
export const studioDocumentMaxBytes = 32 * 1024 * 1024;

export function documentSizeDiagnostic(text: string, path = "document") {
  const bytes = Buffer.byteLength(text, "utf8");
  return bytes > studioDocumentMaxBytes
    ? resourceBudgetDiagnostic("serializedBytes", bytes, studioDocumentMaxBytes, path)
    : undefined;
}
