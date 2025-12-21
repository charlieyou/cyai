---
name: pyspark-style
description: |
  PySpark code style and best practices for DataFrame API. Use when:
  (1) Writing or reviewing PySpark/Python code
  (2) Refactoring Spark transformations
  Triggers: "pyspark", "spark dataframe", "code review", "style", "etl code"
---

# PySpark Style Guide

## Imports

```python
from pyspark.sql import functions as F, types as T
```

## Core Rules

### Do

- Use DataFrame API, never raw SQL strings
- Explicit column selection - no `SELECT *`
- Use `F.col("name")` over `df.name`
- Use `.alias()` instead of `.withColumnRenamed()`
- Use `F.lit(None)` for empty columns, never `""` or `'NA'`
- Specify `how=` in joins: `how="left"`
- Use `left` joins - swap DataFrames rather than `right`
- Use `select()` at start/end of transforms for schema contract
- Use `F.broadcast()` for small dimension tables
- Define `T.StructType` schemas for reads
- Write transforms as pure functions: DataFrame in, DataFrame out

### Don't

- **Never** `.collect()`, `.first()`, `.head()`, `.take()`, `.show()`
- **Avoid** UDFs - use native functions (see below)
- **Avoid** `.otherwise(literal)` catch-alls - masks unknown values
- **Avoid** verbose imports `from pyspark.sql.functions import col, when`

## UDF Alternatives

| UDF Pattern | Native Alternative |
|-------------|-------------------|
| Decimal conversion | `(F.col("val") / F.pow(10, decimals)).cast(T.DecimalType(38,14))` |
| JSON parsing | `F.from_json(F.col("json_str"), schema)` |
| Epoch to date | `F.from_unixtime(F.col("epoch")).cast(T.DateType())` |
| Type conversion | `F.col("val").cast(T.DoubleType())` |

## .otherwise() Rules

```python
# BAD - literal catch-all masks unknowns
F.when(...).otherwise(3)
F.when(...).otherwise("OTHER")

# OK - null fallback or preserve original
F.when(F.col("x").isNull(), 0).otherwise(F.col("x"))
F.when(F.col("net") == "bsc", "bnb").otherwise(F.col("net"))

# BEST - omit to surface unknowns as null
F.when(F.col("action") == "mint", 1).when(F.col("action") == "burn", 2)
```

## Window Functions

```python
# Always explicit ordering; use row_number(), never monotonically_increasing_id()
window = Window.partitionBy("group").orderBy(F.col("ts").desc())
df.withColumn("rn", F.row_number().over(window)).filter(F.col("rn") == 1)
```

## Naming

- **DataFrames**: `df_users`, `df_orders`
- **ETL columns**: `_etl_date`, `_etl_timestamp`, `_source`
- **All columns**: snake_case

## Limits

- **Chaining**: Max 3-5 ops; extract to named functions
- **Filter logic**: Max 3 expressions; extract to variables

See [references/examples.md](references/examples.md) for detailed patterns.
