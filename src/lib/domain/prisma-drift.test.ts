import { describe, it, expect } from "vitest";
import {
  schemaModelFields,
  missingClientFields,
  staleClientHint,
} from "./prisma-drift";

const SCHEMA = `
generator client {
  provider = "prisma-client-js"
}

/// a comment line
model Shelf {
  id           String   @id @default(cuid())
  title        String
  // added in phase 12
  introEnabled Boolean  @default(false)
  introText    String?
  rounds       ShelfItem[]

  @@index([userId])
}

enum Ignored {
  A
  B
}

model ShelfItem {
  id      String @id @default(cuid())
  project Shelf @relation(fields: [projectId], references: [id])
}
`;

describe("schemaModelFields", () => {
  it("collects field names per model, skipping comments and block attributes", () => {
    const models = schemaModelFields(SCHEMA);
    expect([...models.keys()]).toEqual(["Shelf", "ShelfItem"]);
    expect(models.get("Shelf")).toEqual([
      "id",
      "title",
      "introEnabled",
      "introText",
      "rounds",
    ]);
    expect(models.get("ShelfItem")).toEqual(["id", "project"]);
  });
});

describe("missingClientFields", () => {
  const client = [
    { name: "Shelf", fields: [{ name: "id" }, { name: "title" }, { name: "rounds" }] },
    { name: "ShelfItem", fields: [{ name: "id" }, { name: "project" }] },
  ];

  it("lists schema fields the generated client does not know", () => {
    expect(missingClientFields(SCHEMA, client)).toEqual([
      { model: "Shelf", field: "introEnabled" },
      { model: "Shelf", field: "introText" },
    ]);
  });

  it("reports a whole missing model once", () => {
    expect(missingClientFields("model Later {\n  id String @id\n}\n", [])).toEqual([
      { model: "Later", field: "*" },
    ]);
  });

  it("is empty when the client matches the schema", () => {
    const fresh = [
      {
        name: "Shelf",
        fields: [
          { name: "id" },
          { name: "title" },
          { name: "introEnabled" },
          { name: "introText" },
          { name: "rounds" },
        ],
      },
      { name: "ShelfItem", fields: [{ name: "id" }, { name: "project" }] },
    ];
    expect(missingClientFields(SCHEMA, fresh)).toEqual([]);
  });
});

describe("staleClientHint", () => {
  const validationError = Object.assign(
    new Error(
      "\nInvalid `prisma.shelf.update()` invocation:\n\n{\n  data: {\n" +
        "    introEnabled: true,\n    ~~~~~~~~~~~~\n?   title?: String\n  }\n}\n\n" +
        "Unknown argument `introEnabled`. Available options are marked with ?.",
    ),
    { name: "PrismaClientValidationError" },
  );

  it("names the unknown field and asks for generate + restart", () => {
    const hint = staleClientHint(validationError);
    expect(hint).toContain("introEnabled");
    expect(hint).toContain("prisma generate");
    expect(hint).toContain("перезапустите");
  });

  it("also catches the `Unknown field` wording of select/include errors", () => {
    const err = Object.assign(new Error("Unknown field `outroText` for select statement"), {
      name: "PrismaClientValidationError",
    });
    expect(staleClientHint(err)).toContain("outroText");
  });

  it("ignores unrelated errors", () => {
    expect(staleClientHint(new Error("NOT_FOUND"))).toBeNull();
    expect(staleClientHint(new Error("Unique constraint failed on the fields: (`email`)"))).toBeNull();
    expect(staleClientHint(undefined)).toBeNull();
  });
});
