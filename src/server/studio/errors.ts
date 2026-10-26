import type { Diagnostic } from "@/video";
export class StudioError extends Error {
  constructor(
    public code: string,
    public diagnostics: Diagnostic[] = [],
  ) {
    super(code);
    this.name = "StudioError";
  }
}
