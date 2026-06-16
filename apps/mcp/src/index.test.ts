import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { describe, expect, it } from "vitest"

import { asId, ok, type RunProjectCommandInput, type RunProjectCommandResult } from "@sando/shared"

import { createSandoMcpServer, type SandoMcpService } from "./index.js"

describe("sando MCP server", () => {
	it("lists sando tools and calls sando_run_project_command", async () => {
		const runInputs: RunProjectCommandInput[] = []
		const runResult: RunProjectCommandResult = {
			runId: asId("run", "run_123"),
			status: "succeeded",
			exitCode: 0,
			durationMs: 42,
			command: "pnpm test",
			network: "none",
			summary: "Command succeeded: pnpm test",
			logsRef: "sando://runs/run_123/logs",
			stdoutRef: "sando://runs/run_123/stdout",
			stderrRef: "sando://runs/run_123/stderr",
			diffRef: "sando://runs/run_123/diff",
			changedFilesRef: "sando://runs/run_123/changed-files",
			artifacts: [
				{
					id: asId("artifact", "art_logs"),
					name: "logs.txt",
					uri: "sando://artifacts/art_logs",
					contentType: "text/plain",
					sizeBytes: 5,
				},
			],
			auditRef: "sando://runs/run_123/audit",
		}
		const service: SandoMcpService = {
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
		const server = createSandoMcpServer(service)
		const client = new Client({
			name: "sando-mcp-test",
			version: "0.0.0",
		})
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

		await server.connect(serverTransport)
		await client.connect(clientTransport)

		try {
			const tools = await client.listTools()

			expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
				"sando_download_artifact",
				"sando_explain_policy",
				"sando_get_diff",
				"sando_get_run",
				"sando_list_templates",
				"sando_read_logs",
				"sando_run_project_command",
			])

			const result = await client.callTool({
				name: "sando_run_project_command",
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
				logsRef: "sando://runs/run_123/logs",
				diffRef: "sando://runs/run_123/diff",
				artifacts: [
					{
						name: "logs.txt",
						uri: "sando://artifacts/art_logs",
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
