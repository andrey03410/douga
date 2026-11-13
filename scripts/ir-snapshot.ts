/**
 * Prints a sha256 per visual fixture × FPS of the compiled plan JSON.
 * Used to prove that a refactor keeps the IR byte-identical:
 *   npx tsx --tsconfig tsconfig.mcp.json scripts/ir-snapshot.ts > before.json
 */
import { createHash } from "node:crypto";
import { buildVisualFixtures } from "@douga/video/visual-fixtures";
import { compileVideo } from "@douga/video/compiler";
import { getTypographyMeasureText } from "../src/server/studio/typography-fonts";

const FPS = [24, 25, 30, 50, 60] as const;
const measureText = await getTypographyMeasureText();
const out: Record<string, string> = {};
for (const fixture of buildVisualFixtures()) {
  for (const fps of FPS) {
    const document = structuredClone(fixture.document);
    document.output = { ...document.output, fps };
    const result = compileVideo(document, structuredClone(fixture.manifest), { measureText });
    out[`${fixture.id}@${fps}`] = createHash("sha256").update(JSON.stringify(result)).digest("hex");
  }
}
process.stdout.write(JSON.stringify(out, null, 1) + "\n");
