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
AMP_PLUGINS="$HOME/.config/amp/plugins"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
STATUSLINE_SCRIPT="$SCRIPT_DIR/.claude/statusline.sh"

mkdir -p "$CLAUDE_SKILLS" "$CODEX_SKILLS" "$AGENTS_SKILLS" "$CLAUDE_COMMANDS" "$CODEX_PROMPTS" "$CLAUDE_AGENTS" "$AMP_PLUGINS"

# Statusline is configured in settings.json instead of symlinked into ~/.claude.
if [[ -L "$HOME/.claude/statusline.sh" ]]; then
    if [[ "$(readlink "$HOME/.claude/statusline.sh")" == "$STATUSLINE_SCRIPT" ]]; then
        rm "$HOME/.claude/statusline.sh"
        echo "Removed statusline symlink"
    else
        echo "Warning: $HOME/.claude/statusline.sh is a symlink to another location, leaving it unchanged"
    fi
fi

# Clean up stale symlinks (broken symlinks in managed directories)
cleaned=()
for dir in "$CLAUDE_SKILLS" "$CODEX_SKILLS" "$AGENTS_SKILLS" "$CLAUDE_COMMANDS" "$CODEX_PROMPTS" "$CLAUDE_AGENTS" "$AMP_PLUGINS" "$HOME/.claude" "$HOME/.local/bin"; do
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
    [[ "$config_name" == "statusline.sh" ]] && continue

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

if [[ -f "$STATUSLINE_SCRIPT" ]]; then
    chmod +x "$STATUSLINE_SCRIPT" 2>/dev/null || true
    python3 - "$CLAUDE_SETTINGS" "$STATUSLINE_SCRIPT" <<'PY'
import json
import sys
from pathlib import Path

settings_path = Path(sys.argv[1])
statusline_command = sys.argv[2]

if settings_path.exists() and settings_path.read_text().strip():
    settings = json.loads(settings_path.read_text())
else:
    settings = {}

settings["statusLine"] = {
    "type": "command",
    "command": statusline_command,
}

settings_path.write_text(json.dumps(settings, indent=2) + "\n")
PY
    echo "Configured Claude statusLine command: $STATUSLINE_SCRIPT"
fi

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

# Link Amp plugins
amp_plugins=()
for declaration_link in "$AMP_PLUGINS"/*.d.ts; do
    [[ ! -L "$declaration_link" ]] && continue
    if [[ "$(readlink "$declaration_link")" == "$SCRIPT_DIR"/* ]]; then
        rm "$declaration_link"
    fi
done

for plugin_file in "$SCRIPT_DIR"/plugins/amp/*.ts; do
    [[ ! -f "$plugin_file" ]] && continue
    [[ "$plugin_file" == *.d.ts ]] && continue
    plugin_name="$(basename "$plugin_file")"

    target="$AMP_PLUGINS/$plugin_name"
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
    ln -s "$plugin_file" "$target"
    amp_plugins+=("${plugin_name%.ts}")
done

echo "Linked ${#skills[@]} skills: ${skills[*]}"
echo "Linked ${#commands[@]} commands: ${commands[*]}"
echo "Linked ${#agents[@]} agents: ${agents[*]}"
echo "Linked ${#bins[@]} bins: ${bins[*]}"
echo "Linked ${#claude_files[@]} claude configs: ${claude_files[*]}"
echo "Linked ${#amp_plugins[@]} amp plugins: ${amp_plugins[*]}"
