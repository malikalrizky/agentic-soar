import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";

test("package.json has investigate and test scripts", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  expect(pkg.scripts.investigate).toMatch(/cli/);
  expect(pkg.scripts.test).toMatch(/bun test/);
});
