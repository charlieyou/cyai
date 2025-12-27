#!/usr/bin/env python3
"""Find shortest import paths between two modules/packages using grimp."""
from __future__ import annotations

import argparse
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
        description="Find a shortest import chain between two modules/packages using grimp.",
    )
    parser.add_argument("importer", help="Importing module/package")
    parser.add_argument("imported", help="Imported module/package")
    parser.add_argument(
        "--package",
        action="append",
        help="Top-level package to include (repeatable). Defaults to top-level of importer/imported.",
    )
    parser.add_argument(
        "--include-external",
        action="store_true",
        help="Include external packages in the graph.",
    )
    parser.add_argument(
        "--as-packages",
        action="store_true",
        help="Treat importer/imported as packages (not modules).",
    )
    return parser.parse_args()


def _infer_packages(importer: str, imported: str, packages: Iterable[str] | None) -> list[str]:
    if packages:
        return sorted(set(packages))
    inferred = {importer.split(".")[0], imported.split(".")[0]}
    return sorted(inferred)


def main() -> int:
    args = _parse_args()
    grimp = _require_grimp()

    packages = _infer_packages(args.importer, args.imported, args.package)
    graph = grimp.build_graph(
        *packages,
        include_external_packages=args.include_external,
    )

    chain = graph.find_shortest_chain(
        importer=args.importer,
        imported=args.imported,
        as_packages=args.as_packages,
    )

    if chain is None:
        print("No import chain found.")
        return 1

    print(" -> ".join(chain))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
