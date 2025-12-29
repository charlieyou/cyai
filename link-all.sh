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

# Clean up stale symlinks (broken symlinks in managed directories)
cleaned=()
for dir in "$CLAUDE_SKILLS" "$CODEX_SKILLS" "$AGENTS_SKILLS" "$CLAUDE_COMMANDS" "$CODEX_PROMPTS" "$CLAUDE_AGENTS" "$HOME/.claude" "$HOME/.local/bin"; do
    for link in "$dir"/*; do
        [[ ! -L "$link" ]] && continue
        # Clean any broken symlink in managed directories
        if [[ ! -e "$link" ]]; then
            rm "$link"
            cleaned+=("$(basename "$link")")
        fi
    done
done
[[ ${#cleaned[@]} -gt 0 ]] && echo "Cleaned ${#cleaned[@]} stale symlinks: ${cleaned[*]}"

# Copy skills into Codex directory (Codex ignores symlinked skills)
copy_skill_to_codex() {
    local source_dir="$1"
    local target_dir="$2"

    [[ ! -d "$source_dir" ]] && return 0

    if [[ -L "$target_dir" ]]; then
        rm "$target_dir"
    fi
    mkdir -p "$target_dir"
    rsync -a --delete "$source_dir"/ "$target_dir"/
}

# Convert any existing symlinked Codex skills to real copies
for link in "$CODEX_SKILLS"/*; do
    [[ ! -L "$link" ]] && continue
    src="$(readlink "$link")"
    [[ -d "$src" ]] || continue
    name="$(basename "$link")"
    rm "$link"
    copy_skill_to_codex "$src" "$CODEX_SKILLS/$name"
done

# Link skills (directories)
skills=()
for skill_dir in "$SCRIPT_DIR"/skills/*/; do
    [[ ! -d "$skill_dir" ]] && continue
    skill_name="$(basename "$skill_dir")"
    [[ "$skill_name" == .* ]] && continue

    for target in "$CLAUDE_SKILLS/$skill_name" "$CODEX_SKILLS/$skill_name" "$AGENTS_SKILLS/$skill_name"; do
        if [[ "$target" == "$CODEX_SKILLS/$skill_name" ]]; then
            copy_skill_to_codex "$skill_dir" "$target"
            continue
        fi
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

# Link bin scripts
bins=()
for bin_file in "$SCRIPT_DIR"/bin/*; do
    [[ ! -f "$bin_file" ]] && continue
    bin_name="$(basename "$bin_file")"

    target="$HOME/.local/bin/$bin_name"
    if [[ -L "$target" ]]; then
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
    ln -s "$bin_file" "$target"
    chmod +x "$bin_file"
    bins+=("$bin_name")
done

# Link .claude config files (statusline, etc.)
claude_files=()
for config_file in "$SCRIPT_DIR"/.claude/*; do
    [[ ! -f "$config_file" ]] && continue
    config_name="$(basename "$config_file")"

    target="$HOME/.claude/$config_name"
    if [[ -L "$target" ]]; then
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
    ln -s "$config_file" "$target"
    chmod +x "$config_file" 2>/dev/null || true
    claude_files+=("$config_name")
done

# Link review prompts as user-global fallback
review_prompts_source="$SCRIPT_DIR/prompts/reviewers"
review_prompts_target="$HOME/.claude/review-prompts"
if [[ -d "$review_prompts_source" ]]; then
    mkdir -p "$HOME/.claude"
    if [[ -L "$review_prompts_target" ]]; then
        rm "$review_prompts_target"
    elif [[ -d "$review_prompts_target" ]]; then
        rm -rf "$review_prompts_target"
    fi
    ln -s "$review_prompts_source" "$review_prompts_target"
    echo "Linked review-prompts directory as user-global fallback"
fi

echo "Linked ${#skills[@]} skills: ${skills[*]}"
echo "Linked ${#commands[@]} commands: ${commands[*]}"
echo "Linked ${#agents[@]} agents: ${agents[*]}"
echo "Linked ${#bins[@]} bins: ${bins[*]}"
echo "Linked ${#claude_files[@]} claude configs: ${claude_files[*]}"
