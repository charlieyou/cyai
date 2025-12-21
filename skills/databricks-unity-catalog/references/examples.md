# Unity Catalog JSON Examples

## Create Catalog with Storage

```bash
databricks catalogs create my_catalog --storage-root s3://bucket/path --comment "Production catalog"
```

## Create Schema with Properties

```bash
databricks schemas create my_schema my_catalog --comment "Analytics schema"

# Or with JSON for properties
databricks schemas create my_schema my_catalog --json '{
  "comment": "Analytics schema",
  "storage_root": "s3://bucket/schema-path"
}'
```

## Create External Table

```bash
databricks tables create --json '{
  "catalog_name": "my_catalog",
  "schema_name": "my_schema",
  "name": "my_table",
  "table_type": "EXTERNAL",
  "data_source_format": "DELTA",
  "storage_location": "s3://bucket/path/to/data",
  "columns": [
    {"name": "id", "type_name": "LONG"},
    {"name": "name", "type_name": "STRING"},
    {"name": "created_at", "type_name": "TIMESTAMP"}
  ]
}'
```

## Create External Volume

```bash
databricks volumes create my_catalog my_schema my_volume EXTERNAL --storage-location s3://bucket/volume-path
```

## Explore Namespace

```bash
databricks catalogs list --output json | jq -r '.[] | .name' | while read cat; do
  echo "Catalog: $cat"
  databricks schemas list "$cat" --output json 2>/dev/null | jq -r '.[] | .name' | while read schema; do
    echo "  Schema: $schema"
    databricks tables list "$cat" "$schema" --output json 2>/dev/null | jq -r '.[] | .name' | head -5
  done
done
```

## Find Tables by Pattern

```bash
databricks tables list-summaries --catalog-name my_catalog --output json | \
  jq '.tables[] | select(.full_name | contains("sales"))'
```
