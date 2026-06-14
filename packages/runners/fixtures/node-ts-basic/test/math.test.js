import { ok } from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

test("fixture exposes a TypeScript entrypoint", async () => {
	const source = await readFile(new URL("../src/math.ts", import.meta.url), "utf8")

	ok(source.includes("export function add"))
})
