import "server-only";
import { z } from "zod";
import {
  videoContentInputSchema,
  getVideoContentMissingInputs,
  VideoContentError,
} from "@douga/video/content";
import { StudioError } from "./errors";
import { mutationSchema } from "./types";
import { parseVideoDocument } from "@douga/video/schema";
import { applyStudioContentDraft } from "./projects";
export const setStudioContentSchema = mutationSchema
  .extend({ content: videoContentInputSchema })
  .strict();
export type SetStudioContentInput = z.input<typeof setStudioContentSchema>;
export async function setStudioContent(
  userId: string,
  projectId: string,
  raw: SetStudioContentInput,
) {
  try {
    const project = await applyStudioContentDraft(
      userId,
      projectId,
      setStudioContentSchema.parse(raw),
    );
    return {
      ...project,
      missingInputs: getVideoContentMissingInputs(
        parseVideoDocument(
          project.draft ? project.draft.document : project.document,
        ),
      ),
    };
  } catch (error) {
    if (error instanceof VideoContentError)
      throw new StudioError(error.code, [
        {
          severity: "error",
          code: error.code,
          path: error.path,
          message: error.message,
        },
      ]);
    throw error;
  }
}
