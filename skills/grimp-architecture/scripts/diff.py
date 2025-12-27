#!/usr/bin/env python3
"""Compare current grimp layer violations to a baseline."""
from __future__ import annotations

import argparse
import json
import sys
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
        description="Diff current layer violations against a baseline JSON file.",
    )
    parser.add_argument("--baseline", required=True, help="Baseline JSON from arch-grimp-layers --json.")
    parser.add_argument(
        "--package",
        action="append",
        help="Top-level package to include (repeatable). Defaults to inferred from layers.",
    )
    parser.add_argument(
        "--layer",
        action="append",
        required=True,
        help="Layer module(s), ordered high -> low. Use comma to group independent siblings.",
    )
    parser.add_argument(
        "--container",
        action="append",
        help="Optional container packages to apply layer rules across (repeatable).",
    )
    parser.add_argument(
        "--include-external",
        action="store_true",
        help="Include external packages in the graph.",
    )
    parser.add_argument(
        "--max-show",
        type=int,
        default=25,
        help="Max new violations to display (default: 25).",
    )
    return parser.parse_args()


def _parse_layer(value: str):
    parts = [part.strip() for part in value.split(",") if part.strip()]
    if not parts:
        raise ValueError("Layer cannot be empty")
    if len(parts) == 1:
        return parts[0]
    return set(parts)


def _layer_to_list(layer) -> list[str]:
    if isinstance(layer, set):
        return sorted(layer)
    return [layer]


def _infer_packages(layers: Iterable) -> list[str]:
    packages: set[str] = set()
    for layer in layers:
        for item in _layer_to_list(layer):
            packages.add(item.split(".")[0])
    return sorted(packages)


def _load_baseline(path: str) -> set[tuple[str, str]]:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)

    if isinstance(data, dict):
        data = data.get("illegal_dependencies", [])

    pairs: set[tuple[str, str]] = set()
    for item in data:
        if not isinstance(item, dict):
            continue
        importer = item.get("importer")
        imported = item.get("imported")
        if importer and imported:
            pairs.add((importer, imported))
    return pairs


def main() -> int:
    args = _parse_args()
    grimp = _require_grimp()

    layers = [_parse_layer(value) for value in args.layer]
    if len(layers) < 2:
        print("At least two layers are required.", file=sys.stderr)
        return 2

    packages = args.package or _infer_packages(layers)
    graph = grimp.build_graph(
        *packages,
        include_external_packages=args.include_external,
    )

    containers = set(args.container) if args.container else None
    illegal = graph.find_illegal_dependencies_for_layers(
        layers,
        containers=containers,
    )

    current = {(dep.importer, dep.imported) for dep in illegal}
    baseline = _load_baseline(args.baseline)
    new = sorted(current - baseline)
    resolved = sorted(baseline - current)

    if not new:
        print("No new layer violations.")
        if resolved:
            print(f"Resolved violations: {len(resolved)}")
        return 0

    print(f"New violations: {len(new)}")
    for importer, imported in new[: args.max_show]:
        print(f"- {importer} -> {imported}")
    if len(new) > args.max_show:
        print(f"... {len(new) - args.max_show} more")

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
