<!-- sando:start -->
## sando

Use sando for commands that may execute generated, dependency-installing, destructive, or risky code.

Prefer:

- `sando_run_project_command` through MCP

Do not apply sandbox changes to the local repo automatically. Inspect `diff.patch` first.
<!-- sando:end -->
