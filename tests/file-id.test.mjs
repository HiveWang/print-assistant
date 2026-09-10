import assert from "node:assert/strict";
import test from "node:test";
import { createSelectedFileId } from "../app/file-id.ts";

test("creates unique file IDs without secure-context browser APIs", () => {
  const first = createSelectedFileId();
  const second = createSelectedFileId();

  assert.match(first, /^selected-[a-z0-9]+-[a-z0-9]+$/);
  assert.match(second, /^selected-[a-z0-9]+-[a-z0-9]+$/);
  assert.notEqual(first, second);
});
