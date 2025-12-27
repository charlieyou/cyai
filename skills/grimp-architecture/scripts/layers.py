#!/usr/bin/env python3
"""Check layered architecture constraints using grimp."""
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
        description="Check illegal dependencies between layers using grimp.",
    )
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
        "--max-routes",
        type=int,
        default=3,
        help="Max routes to display per dependency (default: 3).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit JSON output instead of text.",
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


def _format_route(route) -> str:
    heads = sorted(route.heads)
    tails = sorted(route.tails)
    middle = list(route.middle)
    head = heads[0] if heads else ""
    tail = tails[0] if tails else ""
    chain = [node for node in [head, *middle, tail] if node]
    if not chain:
        return "(no route)"
    suffix = f" (heads={len(heads)}, tails={len(tails)})"
    return " -> ".join(chain) + suffix


def _serialize_dependency(dep) -> dict:
    return {
        "importer": dep.importer,
        "imported": dep.imported,
        "routes": [
            {
                "heads": sorted(route.heads),
                "middle": list(route.middle),
                "tails": sorted(route.tails),
            }
            for route in dep.routes
        ],
    }


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

    illegal_sorted = sorted(illegal, key=lambda dep: (dep.importer, dep.imported))

    if args.json:
        payload = {
            "packages": packages,
            "layers": [_layer_to_list(layer) for layer in layers],
            "containers": sorted(containers) if containers else [],
            "illegal_dependencies": [_serialize_dependency(dep) for dep in illegal_sorted],
        }
        print(json.dumps(payload, indent=2))
    else:
        if not illegal_sorted:
            print("No illegal dependencies found.")
            return 0

        print("Illegal dependencies:")
        for dep in illegal_sorted:
            print(f"- {dep.importer} -> {dep.imported}")
            for route in list(dep.routes)[: args.max_routes]:
                print(f"    { _format_route(route) }")

    return 2 if illegal_sorted else 0


if __name__ == "__main__":
    raise SystemExit(main())
