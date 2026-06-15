import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { describe, expect, it } from "vitest"

import { asId, ok, type RunProjectCommandInput, type RunProjectCommandResult } from "@sando/shared"

import { createSandhostMcpServer, type SandhostMcpService } from "./index.js"

describe("sandhost MCP server", () => {
	it("lists sandhost tools and calls sandhost_run_project_command", async () => {
		const runInputs: RunProjectCommandInput[] = []
		const runResult: RunProjectCommandResult = {
			runId: asId("run", "run_123"),
			status: "succeeded",
			exitCode: 0,
			durationMs: 42,
			command: "pnpm test",
			network: "none",
			summary: "Command succeeded: pnpm test",
			logsRef: "sandhost://runs/run_123/logs",
			stdoutRef: "sandhost://runs/run_123/stdout",
			stderrRef: "sandhost://runs/run_123/stderr",
			diffRef: "sandhost://runs/run_123/diff",
			changedFilesRef: "sandhost://runs/run_123/changed-files",
			artifacts: [
				{
					id: asId("artifact", "art_logs"),
					name: "logs.txt",
					uri: "sandhost://artifacts/art_logs",
					contentType: "text/plain",
					sizeBytes: 5,
				},
			],
			auditRef: "sandhost://runs/run_123/audit",
		}
		const service: SandhostMcpService = {
			runProjectCommand: async (input) => {
				runInputs.push(input)
				return ok(runResult)
			},
			listTemplates: async () => ok({ templates: [{ name: "node-ts" }] }),
			explainPolicy: async () => ok({ effectivePolicy: { template: "node-ts" } }),
			getRun: async (input) => ok({ runId: input.runId, result: {} }),
			readLogs: async (input) => ok({ runId: input.runId, logs: "logs\n" }),
			getDiff: async (input) => ok({ runId: input.runId, diff: "diff\n" }),
			downloadArtifact: async () => ok({ content: "artifact\n" }),
		}
		const server = createSandhostMcpServer(service)
		const client = new Client({
			name: "sandhost-mcp-test",
			version: "0.0.0",
		})
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

		await server.connect(serverTransport)
		await client.connect(clientTransport)

		try {
			const tools = await client.listTools()

			expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
				"sandhost_download_artifact",
				"sandhost_explain_policy",
				"sandhost_get_diff",
				"sandhost_get_run",
				"sandhost_list_templates",
				"sandhost_read_logs",
				"sandhost_run_project_command",
			])

			const result = await client.callTool({
				name: "sandhost_run_project_command",
				arguments: {
					command: "pnpm test",
				},
			})

			expect(runInputs).toEqual([{ command: "pnpm test" }])
			expect(result.structuredContent).toMatchObject({
				runId: "run_123",
				status: "succeeded",
				exitCode: 0,
				summary: "Command succeeded: pnpm test",
				logsRef: "sandhost://runs/run_123/logs",
				diffRef: "sandhost://runs/run_123/diff",
				artifacts: [
					{
						name: "logs.txt",
						uri: "sandhost://artifacts/art_logs",
					},
				],
			})
			expect((result as { content: readonly unknown[] }).content[0]).toMatchObject({
				type: "text",
				text: expect.stringContaining('"runId": "run_123"'),
			})
		} finally {
			await client.close()
			await server.close()
		}
	})
})
