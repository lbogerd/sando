#!/usr/bin/env bash
set -Eeuo pipefail

workspace="${SANDHOST_WORKSPACE:-/workspace}"
artifacts="${SANDHOST_ARTIFACTS:-/artifacts}"
stdout_file="$artifacts/stdout.txt"
stderr_file="$artifacts/stderr.txt"
logs_file="$artifacts/logs.txt"

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

if [[ "$#" -gt 0 ]]; then
	create_baseline_commit
	run_captured "$@"
	exit "$?"
fi

if [[ -n "${SANDHOST_COMMAND:-}" ]]; then
	create_baseline_commit
	run_captured bash -lc "$SANDHOST_COMMAND"
	exit "$?"
fi

run_captured usage
exit 64
