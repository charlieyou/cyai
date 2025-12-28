#!/usr/bin/env bash
# review-gate-lib.sh - Shared functions for review-gate scripts
#
# Provides path resolution for session-scoped review gate directories.
# Files are stored in ~/.claude/projects/<project-hash>/review-gate/<session-id>/
#
# Usage: source this file from review-gate-* scripts

# Get project hash from transcript path or calculate from project root
# Args: transcript_path (optional)
# Returns: project hash (e.g., -home-cyou-ai-configs)
get_project_hash() {
    local transcript_path="${1:-}"

    # Method 1: Extract from transcript_path
    # Format: ~/.claude/projects/-home-cyou-ai-configs/512c17bf-....jsonl
    if [[ -n "$transcript_path" ]]; then
        local dir_name
        dir_name=$(basename "$(dirname "$transcript_path")")
        if [[ "$dir_name" == -* ]]; then
            echo "$dir_name"
            return 0
        fi
    fi

    # Method 2: Calculate from project root
    local project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
    # Convert /home/cyou/ai-configs to -home-cyou-ai-configs
    echo "$project_root" | sed 's|^/|-|' | tr '/' '-'
}

# Resolve the review directory for a session
# Args: session_id, transcript_path (optional)
# Returns: absolute path to review directory
# If session_id is empty, returns the project-level base directory
resolve_review_dir() {
    local session_id="${1:-}"
    local transcript_path="${2:-}"

    local project_hash
    project_hash=$(get_project_hash "$transcript_path")

    local base_dir="$HOME/.claude/projects/$project_hash/review-gate"

    if [[ -n "$session_id" ]]; then
        echo "$base_dir/$session_id"
    else
        echo "$base_dir"
    fi
}

# Get project-level review base directory (for listing all sessions)
# Args: transcript_path (optional)
# Returns: base directory path without session_id
get_review_base_dir() {
    resolve_review_dir "" "${1:-}"
}

# Find active review gate for current project
# Returns session_id of first pending/awaiting gate, or exits 1 if none found
find_active_gate() {
    local transcript_path="${1:-}"
    local base_dir
    base_dir=$(get_review_base_dir "$transcript_path")

    [[ ! -d "$base_dir" ]] && return 1

    for session_dir in "$base_dir"/*/; do
        [[ ! -d "$session_dir" ]] && continue
        local state_file="$session_dir/gate-state.json"
        [[ ! -f "$state_file" ]] && continue

        local status
        status=$(jq -r '.status // "unknown"' "$state_file" 2>/dev/null || echo "unknown")

        if [[ "$status" == "pending" || "$status" == "awaiting_decision" ]]; then
            basename "$session_dir"
            return 0
        fi
    done

    return 1
}
