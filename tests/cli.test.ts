import { describe, expect, test } from "bun:test";
import { resultPath } from "../src/write-result.ts";

describe("cli helpers", () => {
  test("resultPath maps alert file to result json", () => {
    expect(resultPath("/abs/testdata/alerts/01.json", "var/results")).toBe(
      "var/results/01.result.json",
    );
  });
});
