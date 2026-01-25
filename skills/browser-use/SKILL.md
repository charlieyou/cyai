---
name: browser-use
description: Automates browser interactions for web testing, form filling, screenshots, and data extraction. Use when the user needs to navigate websites, interact with web pages, fill forms, take screenshots, or extract information from web pages.
allowed-tools: Bash(uvx browser-use:*)
---

# Browser Automation with browser-use CLI

The `browser-use` command provides fast, persistent browser automation. It maintains browser sessions across commands, enabling complex multi-step workflows.

## Quick Start

```bash
uvx browser-use open https://example.com           # Navigate to URL
uvx browser-use state                              # Get page elements with indices
uvx browser-use click 5                            # Click element by index
uvx browser-use type "Hello World"                 # Type text
uvx browser-use screenshot                         # Take screenshot
uvx browser-use close                              # Close browser
```

## Core Workflow

1. **Navigate**: `uvx browser-use open <url>` - Opens URL (starts browser if needed)
2. **Inspect**: `uvx browser-use state` - Returns clickable elements with indices
3. **Interact**: Use indices from state to interact (`uvx browser-use click 5`, `uvx browser-use input 3 "text"`)
4. **Verify**: `uvx browser-use state` or `uvx browser-use screenshot` to confirm actions
5. **Repeat**: Browser stays open between commands

## Browser Modes

```bash
uvx browser-use --browser chromium open <url>      # Default: headless Chromium
uvx browser-use --browser chromium --headed open <url>  # Visible Chromium window
uvx browser-use --browser real open <url>          # User's Chrome with login sessions
uvx browser-use --browser remote open <url>        # Cloud browser (requires API key)
```

- **chromium**: Fast, isolated, headless by default
- **real**: Uses your Chrome with cookies, extensions, logged-in sessions
- **remote**: Cloud-hosted browser with proxy support (requires BROWSER_USE_API_KEY)

## Commands

### Navigation
```bash
uvx browser-use open <url>                    # Navigate to URL
uvx browser-use back                          # Go back in history
uvx browser-use scroll down                   # Scroll down
uvx browser-use scroll up                     # Scroll up
```

### Page State
```bash
uvx browser-use state                         # Get URL, title, and clickable elements
uvx browser-use screenshot                    # Take screenshot (outputs base64)
uvx browser-use screenshot path.png           # Save screenshot to file
uvx browser-use screenshot --full path.png    # Full page screenshot
```

### Interactions (use indices from `uvx browser-use state`)
```bash
uvx browser-use click <index>                 # Click element
uvx browser-use type "text"                   # Type text into focused element
uvx browser-use input <index> "text"          # Click element, then type text
uvx browser-use keys "Enter"                  # Send keyboard keys
uvx browser-use keys "Control+a"              # Send key combination
uvx browser-use select <index> "option"       # Select dropdown option
```

### Tab Management
```bash
uvx browser-use switch <tab>                  # Switch to tab by index
uvx browser-use close-tab                     # Close current tab
uvx browser-use close-tab <tab>               # Close specific tab
```

### JavaScript & Data
```bash
uvx browser-use eval "document.title"         # Execute JavaScript, return result
uvx browser-use extract "all product prices"  # Extract data using LLM (requires API key)
```

### Python Execution (Persistent Session)
```bash
uvx browser-use python "x = 42"               # Set variable
uvx browser-use python "print(x)"             # Access variable (outputs: 42)
uvx browser-use python "print(browser.url)"   # Access browser object
uvx browser-use python --vars                 # Show defined variables
uvx browser-use python --reset                # Clear Python namespace
uvx browser-use python --file script.py       # Execute Python file
```

The Python session maintains state across commands. The `browser` object provides:
- `browser.url` - Current page URL
- `browser.title` - Page title
- `browser.goto(url)` - Navigate
- `browser.click(index)` - Click element
- `browser.type(text)` - Type text
- `browser.screenshot(path)` - Take screenshot
- `browser.scroll()` - Scroll page
- `browser.html` - Get page HTML

### Agent Tasks (Requires API Key)
```bash
uvx browser-use run "Fill the contact form with test data"    # Run AI agent
uvx browser-use run "Extract all product prices" --max-steps 50
```

Agent tasks use an LLM to autonomously complete complex browser tasks. Requires `BROWSER_USE_API_KEY` or configured LLM API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc).

### Session Management
```bash
uvx browser-use sessions                      # List active sessions
uvx browser-use close                         # Close current session
uvx browser-use close --all                   # Close all sessions
```

### Server Control
```bash
uvx browser-use server status                 # Check if server is running
uvx browser-use server stop                   # Stop server
uvx browser-use server logs                   # View server logs
```

## Global Options

| Option | Description |
|--------|-------------|
| `--session NAME` | Use named session (default: "default") |
| `--browser MODE` | Browser mode: chromium, real, remote |
| `--headed` | Show browser window (chromium mode) |
| `--profile NAME` | Chrome profile (real mode only) |
| `--json` | Output as JSON |
| `--api-key KEY` | Override API key |

**Session behavior**: All commands without `--session` use the same "default" session. The browser stays open and is reused across commands. Use `--session NAME` to run multiple browsers in parallel.

## Examples

### Form Submission
```bash
uvx browser-use open https://example.com/contact
uvx browser-use state
# Shows: [0] input "Name", [1] input "Email", [2] textarea "Message", [3] button "Submit"
uvx browser-use input 0 "John Doe"
uvx browser-use input 1 "john@example.com"
uvx browser-use input 2 "Hello, this is a test message."
uvx browser-use click 3
uvx browser-use state  # Verify success
```

### Multi-Session Workflows
```bash
uvx browser-use --session work open https://work.example.com
uvx browser-use --session personal open https://personal.example.com
uvx browser-use --session work state    # Check work session
uvx browser-use --session personal state  # Check personal session
uvx browser-use close --all             # Close both sessions
```

### Data Extraction with Python
```bash
uvx browser-use open https://example.com/products
uvx browser-use python "
products = []
for i in range(20):
    browser.scroll('down')
browser.screenshot('products.png')
"
uvx browser-use python "print(f'Captured {len(products)} products')"
```

### Using Real Browser (Logged-In Sessions)
```bash
uvx browser-use --browser real open https://gmail.com
# Uses your actual Chrome with existing login sessions
uvx browser-use state  # Already logged in!
```

## Tips

1. **Always run `uvx browser-use state` first** to see available elements and their indices
2. **Use `--headed` for debugging** to see what the browser is doing
3. **Sessions persist** - the browser stays open between commands
4. **Use `--json` for parsing** output programmatically
5. **Python variables persist** across `uvx browser-use python` commands within a session
6. **Real browser mode** preserves your login sessions and extensions

## Troubleshooting

**Browser won't start?**
```bash
uvx browser-use server stop               # Stop any stuck server
uvx browser-use --headed open <url>       # Try with visible window
```

**Element not found?**
```bash
uvx browser-use state                     # Check current elements
uvx browser-use scroll down               # Element might be below fold
uvx browser-use state                     # Check again
```

**Session issues?**
```bash
uvx browser-use sessions                  # Check active sessions
uvx browser-use close --all               # Clean slate
uvx browser-use open <url>                # Fresh start
```

## Cleanup

**Always close the browser when done.** Run this after completing browser automation:

```bash
uvx browser-use close
```
