# Code Health Check Analysis

**IMPORTANT: This is a READ-ONLY review. Do NOT modify any files. Only analyze and report findings.**

Perform a thorough code health analysis of this codebase. Focus on finding real issues that matter.

## What to Analyze

Search the codebase systematically:

1. **Start at entry points**: `main.py`, `index.ts`, `app.py`, route definitions, exported modules
2. **Follow the dependency graph** from entry points to understand what's actually used
3. **Find hotspots**: large files (>400 lines), utils/helpers directories, files with TODO/FIXME comments
4. **Trace reachability**: code not reachable from entry points = dead code candidate

## What to Look For

### Dead Code & Redundancy
- Unused functions, classes, variables, imports, modules
- Placeholder implementations (`return null`, `// TODO: implement`)
- Multiple implementations of the same thing (logging, HTTP clients, config loading)

### AI-Specific Smells
- Hallucinated or misused APIs (methods that don't exist, wrong parameter order)
- Partial implementations (only happy path, missing error handling)
- Redundant abstraction layers (thin wrappers, over-parameterized helpers)

### Structural Issues
- Large files mixing unrelated concerns
- Oversized functions (>50 lines, deeply nested)
- Misplaced code (domain logic in utils, feature code in common)

### Correctness & Robustness
- Critical paths without tests
- Missing error handling, swallowed exceptions
- Type/contract mismatches between layers

### Hygiene
- Debug cruft (console.log, print, debugger)
- Stale TODOs
- Build artifacts in source control

## Output

Write your findings as free-form analysis. Include:
- What you examined and how
- Issues you found with file paths and line numbers where possible
- Severity assessment (Critical, High, Medium, Low)
- Why each issue matters
- Suggested fixes

Be thorough but concise. Focus on issues that actually matter for code health.

## CRITICAL RULES

1. **DO NOT modify, create, or delete any files** - this is analysis only
2. **DO NOT attempt to fix issues** - only report them
3. **DO NOT install packages or run commands that change state**
4. You may only use read operations: list files, read files, search content
