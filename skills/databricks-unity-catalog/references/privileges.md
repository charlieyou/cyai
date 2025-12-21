# Unity Catalog Privileges

## By Object Type

| Object | Privileges |
|--------|------------|
| Catalog | `USE_CATALOG`, `CREATE_SCHEMA`, `ALL_PRIVILEGES` |
| Schema | `USE_SCHEMA`, `CREATE_TABLE`, `CREATE_VOLUME`, `CREATE_FUNCTION`, `CREATE_MODEL` |
| Table/View | `SELECT`, `MODIFY`, `ALL_PRIVILEGES` |
| Volume | `READ_VOLUME`, `WRITE_VOLUME`, `ALL_PRIVILEGES` |

## Inheritance

Privileges flow down: catalog → schema → table/volume. Granting `USE_CATALOG` on a catalog grants it on all current and future schemas/tables within.

## Grant Examples

```bash
# Grant catalog access to group
databricks grants update catalog my_catalog --json '{
  "changes": [{"principal": "data-engineers", "add": ["USE_CATALOG", "CREATE_SCHEMA"]}]
}'

# Grant table SELECT to user
databricks grants update table my_catalog.my_schema.my_table --json '{
  "changes": [{"principal": "analyst@company.com", "add": ["SELECT"]}]
}'

# Revoke permission
databricks grants update schema my_catalog.my_schema --json '{
  "changes": [{"principal": "user@company.com", "remove": ["CREATE_TABLE"]}]
}'
```

## Check Permissions

```bash
# Direct permissions
databricks grants get table my_catalog.my_schema.my_table

# Effective (includes inherited)
databricks grants get-effective table my_catalog.my_schema.my_table
```
