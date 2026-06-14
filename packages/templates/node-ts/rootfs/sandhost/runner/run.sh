#!/usr/bin/env bash
set -Eeuo pipefail

workspace="${SANDHOST_WORKSPACE:-/workspace}"
artifacts="${SANDHOST_ARTIFACTS:-/artifacts}"

usage() {
	printf 'usage: %s <command> [args...]\n' "$0" >&2
	printf '   or: SANDHOST_COMMAND="pnpm test" %s\n' "$0" >&2
}

mkdir -p "$workspace" "$artifacts"

cd "$workspace"

if [[ "$#" -gt 0 ]]; then
	"$@"
	exit "$?"
fi

if [[ -n "${SANDHOST_COMMAND:-}" ]]; then
	bash -lc "$SANDHOST_COMMAND"
	exit "$?"
fi

usage
exit 64
