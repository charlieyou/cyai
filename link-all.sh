#!/bin/bash
# Symlink skills and commands from ai-configs to .claude and .codex directories

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Target directories
CLAUDE_SKILLS="$HOME/.claude/skills"
CODEX_SKILLS="$HOME/.codex/skills"
CLAUDE_COMMANDS="$HOME/.claude/commands"
CODEX_PROMPTS="$HOME/.codex/prompts"

mkdir -p "$CLAUDE_SKILLS" "$CODEX_SKILLS" "$CLAUDE_COMMANDS" "$CODEX_PROMPTS"

# Link skills (directories)
skills=()
for skill_dir in "$SCRIPT_DIR"/skills/*/; do
    [[ ! -d "$skill_dir" ]] && continue
    skill_name="$(basename "$skill_dir")"
    [[ "$skill_name" == .* ]] && continue

    for target in "$CLAUDE_SKILLS/$skill_name" "$CODEX_SKILLS/$skill_name"; do
        if [[ -L "$target" ]]; then
            rm "$target"
        elif [[ -e "$target" ]]; then
            echo "Warning: $target exists and is not a symlink, skipping"
            continue 2
        fi
        ln -s "$skill_dir" "$target"
    done
    skills+=("$skill_name")
done

# Link commands (files)
commands=()
for cmd_file in "$SCRIPT_DIR"/commands/*.md; do
    [[ ! -f "$cmd_file" ]] && continue
    cmd_name="$(basename "$cmd_file")"

    for target in "$CLAUDE_COMMANDS/$cmd_name" "$CODEX_PROMPTS/$cmd_name"; do
        if [[ -L "$target" ]]; then
            rm "$target"
        elif [[ -e "$target" ]]; then
            echo "Warning: $target exists and is not a symlink, skipping"
            continue 2
        fi
        ln -s "$cmd_file" "$target"
    done
    commands+=("${cmd_name%.md}")
done

echo "Linked ${#skills[@]} skills: ${skills[*]}"
echo "Linked ${#commands[@]} commands: ${commands[*]}"
