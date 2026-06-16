import { EventEmitter } from "node:events"

import { describe, expect, it } from "vitest"

import { browserOpenCommand, openApprovalUrl } from "./sandhost-approval-flow.mjs"

describe("sandhost approval flow script", () => {
	it("chooses wslview for WSL browser opening", () => {
		expect(
			browserOpenCommand("http://127.0.0.1:3123/approval", {
				env: { WSL_DISTRO_NAME: "Ubuntu" },
				platform: "linux",
			}),
		).toEqual({
			command: "wslview",
			args: ["http://127.0.0.1:3123/approval"],
		})
	})

	it("does not crash when the automatic WSL browser opener is missing", async () => {
		const child = new EventEmitter()
		child.unref = () => undefined
		const warnings = []

		await openApprovalUrl("http://127.0.0.1:3123/approval", {
			env: { WSL_DISTRO_NAME: "Ubuntu" },
			platform: "linux",
			spawnCommand: () => child,
			stdout: () => undefined,
			stderr: (message) => warnings.push(message),
		})

		child.emit("error", Object.assign(new Error("spawn wslview ENOENT"), { code: "ENOENT" }))

		expect(warnings).toEqual([
			"Could not open the approval URL automatically: spawn wslview ENOENT",
			"Open this URL manually: http://127.0.0.1:3123/approval",
		])
	})
})
