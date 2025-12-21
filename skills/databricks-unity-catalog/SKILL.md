---
name: databricks-unity-catalog
description: |
  Manage Unity Catalog via Databricks CLI. Use when user wants to:
  (1) Create/list/manage catalogs, schemas, tables, or volumes
  (2) Set up or manage grants and permissions
  (3) Explore the three-level namespace (catalog.schema.table)
  Triggers: "unity catalog", "catalog", "schema", "table permissions", "grants", "volumes", "list tables"
---

# Unity Catalog CLI

Three-level namespace: `catalog.schema.table` or `catalog.schema.volume`

Use `databricks <command> --help` for detailed flags.

## Catalogs

```bash
databricks catalogs list
databricks catalogs get <name>
databricks catalogs create <name> --comment "desc"
databricks catalogs update <name> --comment "updated"
databricks catalogs delete <name>
```

## Schemas

```bash
databricks schemas list <catalog>
databricks schemas get <catalog>.<schema>
databricks schemas create <schema> <catalog>
databricks schemas update <catalog>.<schema> --comment "updated"
databricks schemas delete <catalog>.<schema>
```

## Tables

```bash
databricks tables list <catalog> <schema>
databricks tables list-summaries --catalog-name <catalog>
databricks tables get <catalog>.<schema>.<table>
databricks tables exists <catalog>.<schema>.<table>
databricks tables delete <catalog>.<schema>.<table>
```

## Volumes

```bash
databricks volumes list <catalog> <schema>
databricks volumes read <catalog>.<schema>.<volume>
databricks volumes create <catalog> <schema> <name> MANAGED
databricks volumes update <catalog>.<schema>.<volume> --comment "updated"
databricks volumes delete <catalog>.<schema>.<volume>
```

## Grants

```bash
databricks grants get catalog <name>
databricks grants get schema <catalog>.<schema>
databricks grants get table <catalog>.<schema>.<table>
databricks grants get-effective <type> <full-name>
databricks grants update <type> <full-name> --json '{...}'
```

See [privileges.md](references/privileges.md) for privilege matrix and grant examples.

## References

- [privileges.md](references/privileges.md) - Privilege matrix, grant/revoke examples
- [examples.md](references/examples.md) - JSON payloads for create operations, exploration scripts
