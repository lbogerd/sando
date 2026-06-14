#!/usr/bin/env bash
set -Eeuo pipefail

workspace="${SANDHOST_WORKSPACE:-/workspace}"
artifacts="${SANDHOST_ARTIFACTS:-/artifacts}"
stdout_file="$artifacts/stdout.txt"
stderr_file="$artifacts/stderr.txt"
logs_file="$artifacts/logs.txt"
diff_file="$artifacts/diff.patch"
changed_files_file="$artifacts/changed-files.txt"

usage() {
	printf 'usage: %s <command> [args...]\n' "$0" >&2
	printf '   or: SANDHOST_COMMAND="pnpm test" %s\n' "$0" >&2
}

mkdir -p "$workspace" "$artifacts"

cd "$workspace"

create_baseline_commit() {
	git init --quiet
	git config user.email "sandhost@example.local"
	git config user.name "sandhost"
	git add -A
	git commit --quiet --allow-empty -m "sandhost baseline"
}

reset_capture_files() {
	: > "$stdout_file"
	: > "$stderr_file"
	: > "$logs_file"
}

run_captured() {
	reset_capture_files

	local status
	set +e
	"$@" > >(tee -a "$stdout_file" | tee -a "$logs_file") \
		2> >(tee -a "$stderr_file" | tee -a "$logs_file" >&2)
	status="$?"
	set -e

	return "$status"
}

capture_workspace_changes() {
	git add -N .
	git diff --binary HEAD > "$diff_file"
	git status --porcelain=v1 > "$changed_files_file"
}

run_project_command() {
	create_baseline_commit

	local status
	if run_captured "$@"; then
		status=0
	else
		status="$?"
	fi

	capture_workspace_changes
	return "$status"
}

if [[ "$#" -gt 0 ]]; then
	run_project_command "$@"
	exit "$?"
fi

if [[ -n "${SANDHOST_COMMAND:-}" ]]; then
	run_project_command bash -lc "$SANDHOST_COMMAND"
	exit "$?"
fi

run_captured usage
exit 64
