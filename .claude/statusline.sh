#!/bin/bash
# Claude Code statusline script
# Set DEBUG=1 to see actual token values: DEBUG=1 claude

# Read JSON input from stdin
input=$(cat)

# Extract information from JSON
model_name=$(echo "$input" | jq -r '.model.display_name')
current_dir=$(echo "$input" | jq -r '.workspace.current_dir')
effort_level=$(echo "$input" | jq -r '.effort.level // empty')
thinking_enabled=$(echo "$input" | jq -r 'if .thinking.enabled == null then empty else .thinking.enabled end')

case "$effort_level" in
    low|medium|high|xhigh|max)
        if [ "$thinking_enabled" != "false" ]; then
            thinking_info="$effort_level"
        else
            thinking_info="off"
        fi
        ;;
    *)
        thinking_info="off"
        ;;
esac

# Extract context window information
# total_context = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
context_max=$(echo "$input" | jq -r '.context_window.context_window_size // 200000')
usage=$(echo "$input" | jq '.context_window.current_usage')
if [ "$usage" != "null" ]; then
    context_used=$(echo "$usage" | jq '.input_tokens + .cache_creation_input_tokens + .cache_read_input_tokens')
else
    context_used=0
fi

# Get directory name (replace home directory with ~, abbreviate parent dirs)
shorten_parent_dir() {
    local segment="$1"

    if [[ "$segment" == .* && ${#segment} -gt 1 ]]; then
        printf '.%s' "${segment:1:1}"
    else
        printf '%s' "${segment:0:1}"
    fi
}

shorten_dir_path() {
    local path="$1"

    if [[ "$path" == "$HOME" ]]; then
        printf '~\n'
        return
    fi

    if [[ "$path" == "$HOME"/* ]]; then
        path="~/${path#$HOME/}"
    fi

    if [[ "$path" == "/" ]]; then
        printf '/\n'
        return
    fi

    local prefix=""
    local rest="$path"
    if [[ "$rest" == ~/* ]]; then
        prefix="~"
        rest="${rest#~/}"
    elif [[ "$rest" == /* ]]; then
        prefix="/"
        rest="${rest#/}"
    fi

    IFS='/' read -ra parts <<< "$rest"
    local last_index=$((${#parts[@]} - 1))
    local shortened="$prefix"
    local segment
    local piece

    for i in "${!parts[@]}"; do
        segment="${parts[$i]}"
        [ -z "$segment" ] && continue

        if [ "$i" -eq "$last_index" ]; then
            piece="$segment"
        else
            piece=$(shorten_parent_dir "$segment")
        fi

        if [ "$shortened" = "/" ]; then
            shortened="/$piece"
        elif [ -n "$shortened" ]; then
            shortened="$shortened/$piece"
        else
            shortened="$piece"
        fi
    done

    printf '%s\n' "$shortened"
}

dir_name=$(shorten_dir_path "$current_dir")

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

case "$thinking_info" in
    off)
        thinking_color="$GRAY"
        ;;
    low)
        thinking_color="$GREEN"
        ;;
    medium)
        thinking_color="$CYAN"
        ;;
    high)
        thinking_color="$YELLOW"
        ;;
    xhigh)
        thinking_color="$RED"
        ;;
    max)
        thinking_color="$MAGENTA"
        ;;
    *)
        thinking_color="$GRAY"
        ;;
esac

thinking_segment=" ${GRAY}|${NC} ${thinking_color}${thinking_info}${NC}"

# Change to the current directory to get git info
cd "$current_dir" 2>/dev/null || cd /

# Get git branch
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    branch=$(git branch --show-current 2>/dev/null || echo "detached")

    # Get git status with file counts
    status_output=$(git status --porcelain 2>/dev/null)

    if [ -n "$status_output" ]; then
        # Count files and get basic line stats
        total_files=$(echo "$status_output" | wc -l | xargs)
        line_stats=$(git diff --numstat HEAD 2>/dev/null | awk '{added+=$1; removed+=$2} END {print added+0, removed+0}')

        added=$(echo $line_stats | cut -d' ' -f1)
        removed=$(echo $line_stats | cut -d' ' -f2)

        # Build status display
        git_info=" ${YELLOW}($branch${NC} ${YELLOW}|${NC} ${GRAY}${total_files} files${NC}"

        [ "$added" -gt 0 ] && git_info="${git_info} ${GREEN}+${added}${NC}"
        [ "$removed" -gt 0 ] && git_info="${git_info} ${RED}-${removed}${NC}"

        git_info="${git_info} ${YELLOW})${NC}"
    else
        git_info=" ${YELLOW}($branch)${NC}"
    fi
else
    git_info=""
fi

# Calculate percentage and build progress bar
context_percent=$((context_used * 100 / context_max))
bar_width=15
filled=$((context_percent * bar_width / 100))
empty=$((bar_width - filled))
bar=""
for ((i=0; i<filled; i++)); do bar+="█"; done
for ((i=0; i<empty; i++)); do bar+="░"; done

# Format numbers as k
used_k=$((context_used / 1000))
max_k=$((context_max / 1000))

# Build context display: bar + percentage + raw numbers in parens
context_info="${GRAY}${bar}${NC} ${context_percent}% (${used_k}k/${max_k}k)"

# Output the status line
echo -e "${BLUE}${dir_name}${NC} ${GRAY}|${NC} ${CYAN}${model_name}${NC}${thinking_segment} ${GRAY}|${NC} ${context_info}${git_info:+ ${GRAY}|${NC}}${git_info}"
