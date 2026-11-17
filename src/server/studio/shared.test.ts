import { expect, it } from "vitest";
import { canonical, jsonText, requestHash } from "./shared";
import { saveStudioDraftSchema } from "./types";

const bytes = 32 * 1024 * 1024;
it.each([
  { name: "ASCII", character: "x", count: bytes - 2 },
  { name: "Cyrillic", character: "я", count: (bytes - 2) / 2 },
  { name: "surrogate pairs", character: "😀", count: (bytes - 4) / 4, tail: "xx" },
  { name: "unpaired surrogates escaped by JSON", character: "\ud800", count: (bytes - 2) / 6 },
])("uses the same 32 MiB UTF-8 boundary for serialized $name and draft text", ({ character, count, tail }) => {
  const value = character.repeat(count) + (tail ?? "");
  const text = jsonText(value);
  expect(Buffer.byteLength(text, "utf8")).toBe(bytes);
  expect(saveStudioDraftSchema.safeParse({ expectedVersion: 1, text }).success).toBe(true);
  expect(() => jsonText(`${value}x`)).toThrow("DOCUMENT_TOO_LARGE");
  const rejected = saveStudioDraftSchema.safeParse({ expectedVersion: 1, text: `${text} ` });
  expect(rejected.success).toBe(false);
  if (!rejected.success) {
    expect(rejected.error.issues[0].path).toEqual(["text"]);
    expect(rejected.error.issues[0].message).toContain(`resource=serializedBytes; used=${bytes + 1}; limit=${bytes}`);
  }
});

it("includes a concrete byte budget diagnostic when object serialization is too large", () => {
  try {
    jsonText("я".repeat(bytes / 2));
    throw new Error("Expected byte limit rejection");
  } catch (error) {
    expect(error).toMatchObject({
      code: "DOCUMENT_TOO_LARGE",
      diagnostics: [{ code: "RESOURCE_BUDGET_EXCEEDED", path: "document", message: `resource=serializedBytes; used=${bytes + 2}; limit=${bytes}` }],
    });
  }
});

it.each([
  { name: "jsonText", serialize: jsonText },
  { name: "canonical", serialize: canonical },
  { name: "requestHash", serialize: (input: unknown) => requestHash("save", input) },
])("rejects cyclic $name input as a bounded resource error", ({ serialize }) => {
  const value: Record<string, unknown> = {};
  value.self = value;
  try {
    serialize(value);
    throw new Error("Expected cycle rejection");
  } catch (error) {
    expect(error).toMatchObject({ code: "DOCUMENT_TOO_LARGE", diagnostics: [
      { code: "RESOURCE_BUDGET_EXCEEDED", message: "resource=cycles; used=1; limit=0" },
    ] });
  }
});

it("hashes repeated noncyclic references with the same canonical JSON semantics", () => {
  const common = { b: 1, a: undefined };
  expect(canonical({ second: common, first: common, missing: undefined })).toBe('{"first":{"b":1},"second":{"b":1}}');
  expect(requestHash("save", { a: common, b: common })).toBe(requestHash("save", { b: { b: 1 }, a: { b: 1 } }));
});
