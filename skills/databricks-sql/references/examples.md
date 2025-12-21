# Databricks SQL Examples

## Table Exploration

```sql
-- List tables in a schema
SHOW TABLES IN catalog.schema

-- Describe table structure
DESCRIBE TABLE catalog.schema.table
DESCRIBE TABLE EXTENDED catalog.schema.table

-- Get table properties
SHOW TBLPROPERTIES catalog.schema.table

-- Sample data
SELECT * FROM catalog.schema.table LIMIT 10
SELECT * FROM catalog.schema.table TABLESAMPLE (100 ROWS)
```

## Delta Lake Operations

```sql
-- Table history
DESCRIBE HISTORY catalog.schema.table
DESCRIBE HISTORY catalog.schema.table LIMIT 10

-- Time travel (query as of version or timestamp)
SELECT * FROM catalog.schema.table VERSION AS OF 5
SELECT * FROM catalog.schema.table TIMESTAMP AS OF '2024-01-15'

-- Table details
DESCRIBE DETAIL catalog.schema.table
```

## Data Profiling

```sql
-- Row count
SELECT COUNT(*) as total_rows FROM catalog.schema.table

-- Column statistics
SELECT
    COUNT(*) as total,
    COUNT(DISTINCT column_name) as distinct_values,
    COUNT(*) - COUNT(column_name) as null_count,
    MIN(column_name) as min_value,
    MAX(column_name) as max_value
FROM catalog.schema.table

-- Value distribution
SELECT column_name, COUNT(*) as cnt
FROM catalog.schema.table
GROUP BY column_name
ORDER BY cnt DESC
LIMIT 20

-- Date range
SELECT MIN(date_col) as earliest, MAX(date_col) as latest
FROM catalog.schema.table
```

## Common Patterns

```sql
-- Top N per group
SELECT * FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY group_col ORDER BY value_col DESC) as rn
    FROM catalog.schema.table
) WHERE rn <= 5

-- Pivot
SELECT * FROM catalog.schema.table
PIVOT (SUM(amount) FOR category IN ('A', 'B', 'C'))

-- Window functions
SELECT
    *,
    SUM(amount) OVER (PARTITION BY customer_id ORDER BY date) as running_total,
    LAG(amount) OVER (PARTITION BY customer_id ORDER BY date) as prev_amount
FROM catalog.schema.table

-- CTE (Common Table Expression)
WITH filtered AS (
    SELECT * FROM catalog.schema.table WHERE status = 'active'
)
SELECT * FROM filtered WHERE amount > 100
```

## DDL Examples

**Caution:** These statements modify or delete objects. Run on non-production first and double-check names.

```sql
-- Create table
CREATE TABLE IF NOT EXISTS catalog.schema.new_table (
    id BIGINT,
    name STRING,
    created_at TIMESTAMP
) USING DELTA

-- Create table as select
CREATE TABLE catalog.schema.new_table AS
SELECT * FROM catalog.schema.source_table WHERE condition

-- Add column
ALTER TABLE catalog.schema.table ADD COLUMN new_col STRING

-- Drop table
DROP TABLE IF EXISTS catalog.schema.table
```

## DML Examples

**Caution:** These statements mutate data. Always validate filters and consider backups before running.

```sql
-- Insert
INSERT INTO catalog.schema.table VALUES (1, 'name', current_timestamp())

-- Insert from select
INSERT INTO catalog.schema.target
SELECT * FROM catalog.schema.source WHERE condition

-- Update
UPDATE catalog.schema.table SET status = 'inactive' WHERE last_active < '2024-01-01'

-- Delete
DELETE FROM catalog.schema.table WHERE status = 'deleted'

-- Merge (upsert)
MERGE INTO catalog.schema.target t
USING catalog.schema.source s ON t.id = s.id
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *
```

## Optimization

```sql
-- Optimize table
OPTIMIZE catalog.schema.table

-- Optimize with Z-ordering
OPTIMIZE catalog.schema.table ZORDER BY (column1, column2)

-- Vacuum (remove old files)
VACUUM catalog.schema.table RETAIN 168 HOURS

-- Analyze table (compute statistics)
ANALYZE TABLE catalog.schema.table COMPUTE STATISTICS
```
