# PySpark Style Examples

## Imports

```python
# Good
from pyspark.sql import functions as F, types as T

# Bad
from pyspark.sql.functions import col, when, lit, sum as spark_sum
```

## Schema Definitions

```python
# Good - explicit schema
schema = T.StructType([
    T.StructField("id", T.StringType(), False),
    T.StructField("amount", T.DecimalType(38, 14), True),
    T.StructField("date", T.DateType(), True),
])
df = spark.read.schema(schema).json(path)

# Bad - inference
df = spark.read.json(path)
```

## UDF Replacements

```python
# Decimal conversion
# Bad
@udf(returnType=DecimalType(38, 14))
def convert_decimal(value, decimals):
    return Decimal(int(value) / 10**decimals) if value else None

# Good
(F.col("value") / F.pow(10, F.col("decimals"))).cast(T.DecimalType(38, 14))

# JSON parsing
# Bad
@udf(returnType=MapType(StringType(), StringType()))
def parse_json(s):
    return json.loads(s)

# Good
F.from_json(F.col("json_str"), schema)
F.from_json(F.col("json_str"), "MAP<STRING, STRING>")

# Epoch to date
# Bad
@udf(returnType=StringType())
def epoch_to_date(ts):
    return datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d") if ts else None

# Good
F.from_unixtime(F.col("epoch")).cast(T.DateType())
F.from_unixtime(F.col("epoch_ms") / 1000).cast(T.DateType())  # milliseconds
```

## Broadcast Joins

```python
# Good
df_result = df_large.join(F.broadcast(df_small), on="key", how="left")

# With alias for complex joins
df_result = (
    df_txns.alias("t")
    .join(F.broadcast(df_tokens).alias("tok"), F.col("t.token_id") == F.col("tok.id"), how="left")
)
```

## Window Functions

```python
from pyspark.sql import Window

# Deduplication by latest
window = Window.partitionBy("group_id").orderBy(F.col("_etl_timestamp").desc())
df.withColumn("rn", F.row_number().over(window)).filter(F.col("rn") == 1).drop("rn")

# Forward fill
window = Window.partitionBy("id").orderBy("date").rowsBetween(Window.unboundedPreceding, 0)
df.withColumn("value", F.last("value", ignorenulls=True).over(window))

# Bad - no ordering
Window.partitionBy("group")  # non-deterministic

# Bad - monotonically_increasing_id
df.withColumn("id", F.monotonically_increasing_id())  # non-deterministic
```

## Joins

```python
# Good
df_users.join(df_orders.drop("created_at"), on="user_id", how="left")

# Bad - implicit inner, column conflicts
df_users.join(df_orders, "user_id")

# Bad - right join
df_orders.join(df_users, "user_id", how="right")  # swap and use left
```

## Column Operations

```python
# Renaming - Good
df.select(F.col("old").alias("new"), F.col("other"))

# Renaming - Bad
df.withColumnRenamed("old", "new")

# Nulls - Good
F.lit(None).cast(T.StringType())

# Nulls - Bad
F.lit("")
F.lit("NA")
```

## Conditional Logic

```python
# Good - extracted conditions
is_premium = F.col("tier") == "premium"
is_active = F.col("status") == "active"
df.withColumn("segment", F.when(is_premium & is_active, "high_value"))

# Bad - inline complex logic with catch-all
df.withColumn("segment",
    F.when((F.col("tier") == "premium") & (F.col("status") == "active"), "high")
     .otherwise("unknown")  # masks issues
)

# .otherwise() usage:
# BAD: F.when(...).otherwise(3)           # literal catch-all
# BAD: F.when(...).otherwise("OTHER")     # masks unknown values
# OK:  F.when(x.isNull(), 0).otherwise(x) # null fallback
# OK:  F.when(x == "old", "new").otherwise(x)  # preserve original
```

## Pure Functions

```python
# Good - DataFrame in/out
def dedupe(df: DataFrame, cols: list) -> DataFrame:
    w = Window.partitionBy(*cols).orderBy(F.col("_etl_timestamp").desc())
    return df.withColumn("_rn", F.row_number().over(w)).filter(F.col("_rn") == 1).drop("_rn")

# Chain with .transform()
df.transform(add_etl_cols).transform(dedupe, ["user_id"])

# Bad - side effects
def process():
    global result_df
    result_df = spark.table("x").filter(...)
    result_df.write.saveAsTable("y")
```

## Naming

```python
# DataFrames
df_users = spark.table("gold.dim_user")
raw_events_df = spark.read.json(path)

# ETL columns
df.withColumn("_etl_date", F.current_date())
df.withColumn("_source", F.lit("api"))

# Bad - inconsistent
df.select(F.col("userId"), F.col("OrderCount"), F.col("AMOUNT"))
```

## Anti-patterns

```python
# Never - breaks distributed processing
df.collect()
df.first()
df.take(10)
df.show()

# Instead
df.filter(F.col("id") == target)
df.groupBy("cat").agg(F.sum("amt"))
```
