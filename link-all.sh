#!/bin/bash
# Symlink skills and commands from ai-configs to .claude, .codex, and .agents directories

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Target directories
CLAUDE_SKILLS="$HOME/.claude/skills"
CODEX_SKILLS="$HOME/.codex/skills"
AGENTS_SKILLS="$HOME/.agents/skills"
CLAUDE_COMMANDS="$HOME/.claude/commands"
CODEX_PROMPTS="$HOME/.codex/prompts"
CLAUDE_AGENTS="$HOME/.claude/agents"

mkdir -p "$CLAUDE_SKILLS" "$CODEX_SKILLS" "$AGENTS_SKILLS" "$CLAUDE_COMMANDS" "$CODEX_PROMPTS" "$CLAUDE_AGENTS"

# Clean up stale symlinks (pointing to this repo but target no longer exists)
cleaned=()
for dir in "$CLAUDE_SKILLS" "$CODEX_SKILLS" "$AGENTS_SKILLS" "$CLAUDE_COMMANDS" "$CODEX_PROMPTS" "$CLAUDE_AGENTS"; do
    for link in "$dir"/*; do
        [[ ! -L "$link" ]] && continue
        target="$(readlink "$link")"
        # Only clean symlinks pointing to this repo
        if [[ "$target" == "$SCRIPT_DIR"/* ]] && [[ ! -e "$link" ]]; then
            rm "$link"
            cleaned+=("$(basename "$link")")
        fi
    done
done
[[ ${#cleaned[@]} -gt 0 ]] && echo "Cleaned ${#cleaned[@]} stale symlinks: ${cleaned[*]}"

# Link skills (directories)
skills=()
for skill_dir in "$SCRIPT_DIR"/skills/*/; do
    [[ ! -d "$skill_dir" ]] && continue
    skill_name="$(basename "$skill_dir")"
    [[ "$skill_name" == .* ]] && continue

    for target in "$CLAUDE_SKILLS/$skill_name" "$CODEX_SKILLS/$skill_name" "$AGENTS_SKILLS/$skill_name"; do
        if [[ -L "$target" ]]; then
            # Only remove if it points to this repo
            if [[ "$(readlink "$target")" == "$SCRIPT_DIR"/* ]]; then
                rm "$target"
            else
                echo "Warning: $target is a symlink to another location, skipping"
                continue 2
            fi
        elif [[ -e "$target" ]]; then
            echo "Warning: $target exists and is not a symlink, skipping"
            continue 2
        fi
        ln -s "$skill_dir" "$target"
    done

    # Make scripts executable
    if [[ -d "$skill_dir/scripts" ]]; then
        chmod +x "$skill_dir/scripts"/*.sh 2>/dev/null || true
    fi

    skills+=("$skill_name")
done

# Link commands (files)
commands=()
for cmd_file in "$SCRIPT_DIR"/commands/*.md; do
    [[ ! -f "$cmd_file" ]] && continue
    cmd_name="$(basename "$cmd_file")"

    for target in "$CLAUDE_COMMANDS/$cmd_name" "$CODEX_PROMPTS/$cmd_name"; do
        if [[ -L "$target" ]]; then
            # Only remove if it points to this repo
            if [[ "$(readlink "$target")" == "$SCRIPT_DIR"/* ]]; then
                rm "$target"
            else
                echo "Warning: $target is a symlink to another location, skipping"
                continue 2
            fi
        elif [[ -e "$target" ]]; then
            echo "Warning: $target exists and is not a symlink, skipping"
            continue 2
        fi
        ln -s "$cmd_file" "$target"
    done
    commands+=("${cmd_name%.md}")
done

# Link agents (files)
agents=()
for agent_file in "$SCRIPT_DIR"/agents/*.md; do
    [[ ! -f "$agent_file" ]] && continue
    agent_name="$(basename "$agent_file")"

    target="$CLAUDE_AGENTS/$agent_name"
    if [[ -L "$target" ]]; then
        # Only remove if it points to this repo
        if [[ "$(readlink "$target")" == "$SCRIPT_DIR"/* ]]; then
            rm "$target"
        else
            echo "Warning: $target is a symlink to another location, skipping"
            continue
        fi
    elif [[ -e "$target" ]]; then
        echo "Warning: $target exists and is not a symlink, skipping"
        continue
    fi
    ln -s "$agent_file" "$target"
    agents+=("${agent_name%.md}")
done

echo "Linked ${#skills[@]} skills: ${skills[*]}"
echo "Linked ${#commands[@]} commands: ${commands[*]}"
echo "Linked ${#agents[@]} agents: ${agents[*]}"
