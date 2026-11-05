import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { missingClientFields, schemaModelFields } from "@/lib/domain/prisma-drift";

/** "Model.field" for every schema field whose type is another model (a relation, no column). */
function relationFields(schema: string): Set<string> {
  const models = new Set(schemaModelFields(schema).keys());
  const out = new Set<string>();
  let current: string | null = null;
  for (const raw of schema.split("\n")) {
    const line = raw.trim();
    const open = /^model\s+(\w+)\s*\{/.exec(line);
    if (open) current = open[1];
    else if (line === "}") current = null;
    else if (current && !line.startsWith("//") && !line.startsWith("@@")) {
      const [name, type] = line.split(/\s+/);
      if (type && models.has(type.replace(/[?[\]]/g, ""))) out.add(`${current}.${name}`);
    }
  }
  return out;
}

// Regression guard for the "opaque 500 after a schema change" trap: the DB and
// the code get the new columns, but the generated Prisma client does not, so
// every write with a new field dies with `Unknown argument`. Failing here means
// `npx prisma generate` was not run (and any running dev server needs a
// restart — it keeps the old client in memory).
describe("generated Prisma client", () => {
  it("knows every model and field of schema.prisma", () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    // Prisma 7 no longer exports Prisma.dmmf. The public per-model
    // ScalarFieldEnum lists the columns the client knows; relation fields have
    // no column and are covered by the model check.
    const enums = Prisma as unknown as Record<string, Record<string, string> | undefined>;
    const models = Object.values(Prisma.ModelName).map((name) => ({
      name,
      fields: Object.values(enums[`${name}ScalarFieldEnum`] ?? {}).map((f) => ({ name: f })),
    }));
    const relations = relationFields(schema);
    expect(
      missingClientFields(schema, models).filter((m) => !relations.has(`${m.model}.${m.field}`)),
    ).toEqual([]);
  });
});
