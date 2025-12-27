#!/usr/bin/env python3
"""Explore a Python import graph with grimp."""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from typing import Iterable


def _require_grimp():
    try:
        import grimp  # type: ignore
    except ImportError:
        print("grimp is not installed. Install with: pip install grimp", file=sys.stderr)
        sys.exit(1)
    return grimp


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Explore a Python import graph (fan-in/out, children) using grimp.",
    )
    parser.add_argument(
        "package",
        nargs="+",
        help="Top-level package(s) to analyze (importable name)",
    )
    parser.add_argument(
        "--include-external",
        action="store_true",
        help="Include external packages in the graph.",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=10,
        help="How many entries to show in fan-in/out lists (default: 10).",
    )
    parser.add_argument(
        "--min-in",
        type=int,
        default=2,
        help="Minimum fan-in to display (default: 2).",
    )
    parser.add_argument(
        "--min-out",
        type=int,
        default=4,
        help="Minimum fan-out to display (default: 4).",
    )
    parser.add_argument(
        "--max-children",
        type=int,
        default=40,
        help="Max children to list per top-level package (default: 40).",
    )
    return parser.parse_args()


def _is_internal(module: str, packages: Iterable[str]) -> bool:
    for pkg in packages:
        if module == pkg or module.startswith(pkg + "."):
            return True
    return False


def _sorted_modules(counter: Counter[str], top: int) -> list[tuple[str, int]]:
    return sorted(counter.items(), key=lambda item: (-item[1], item[0]))[:top]


def main() -> int:
    args = _parse_args()
    grimp = _require_grimp()

    graph = grimp.build_graph(
        *args.package,
        include_external_packages=args.include_external,
    )

    packages = args.package
    internal_modules = [m for m in graph.modules if _is_internal(m, packages)]

    print("Grimp import graph summary")
    print(f"Packages: {', '.join(packages)}")
    print(f"Modules: {len(internal_modules)}")
    print(f"Total imports: {graph.count_imports()}")

    for pkg in packages:
        children = sorted(graph.find_children(pkg))
        print(f"\nChildren of {pkg} ({len(children)}):")
        for child in children[: args.max_children]:
            descendant_count = len(graph.find_descendants(child))
            print(f"  - {child} ({descendant_count} descendants)")
        if len(children) > args.max_children:
            print(f"  ... {len(children) - args.max_children} more")

    fan_out = Counter()
    fan_in = Counter()
    for module in internal_modules:
        fan_out[module] = len(graph.find_modules_directly_imported_by(module))
        fan_in[module] = len(graph.find_modules_that_directly_import(module))

    print("\nTop fan-out (imports many modules):")
    shown_out = False
    for module, count in _sorted_modules(fan_out, args.top):
        if count < args.min_out:
            continue
        print(f"  - {module}: {count}")
        shown_out = True
    if not shown_out:
        print("  (none over threshold)")

    print("\nTop fan-in (imported by many modules):")
    shown_in = False
    for module, count in _sorted_modules(fan_in, args.top):
        if count < args.min_in:
            continue
        print(f"  - {module}: {count}")
        shown_in = True
    if not shown_in:
        print("  (none over threshold)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
