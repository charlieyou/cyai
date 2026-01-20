# DuneSQL Query Engine Reference

DuneSQL is a Trino (PrestoSQL) fork optimized for blockchain analytics.

## Key Features

- **Varbinary Data Types**: Addresses and hashes stored as `varbinary`, prefixed with `0x`
- **UINT256 & INT256 Support**: Native 256-bit integer types for blockchain's large numbers
- **Columnar Storage**: Optimized read speed, select only needed columns
- **Time-Partitioned Tables**: Most tables partitioned by `block_date` or `block_time`

## DuneSQL vs Standard SQL

| Feature | DuneSQL | Standard SQL |
|---------|---------|--------------|
| Addresses | `varbinary` with `0x` prefix | String |
| Large integers | `uint256`, `int256` | Not supported |
| Token amounts | `uint256` (raw), divide by decimals | N/A |
| Time partitioning | Always filter by `block_date`/`block_time` | Optional |

## Query Optimization Best Practices

### 1. Always Filter by Time (Partition Pruning)
```sql
-- GOOD: Uses partition pruning
SELECT hash, "from", "to", value
FROM ethereum.transactions
WHERE block_date >= TIMESTAMP '2024-01-01'
  AND block_date < TIMESTAMP '2024-01-02'

-- BAD: Full table scan
SELECT * FROM ethereum.transactions
WHERE "to" = 0x...
```

### 2. Filter Cross-Chain Tables by Blockchain
```sql
-- GOOD: Filters both blockchain and time
SELECT block_time, tx_hash, amount_usd
FROM dex.trades
WHERE blockchain = 'ethereum'
  AND block_time >= NOW() - INTERVAL '7' DAY
```

### 3. Select Only Required Columns
```sql
-- GOOD: Specific columns
SELECT evt_block_time, "from", "to", value
FROM erc20_ethereum.evt_Transfer
WHERE contract_address = 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48

-- BAD: All columns
SELECT * FROM erc20_ethereum.evt_Transfer
```

### 4. Use LIMIT with ORDER BY
```sql
-- GOOD: Limit sorted results
SELECT hash, gas_price
FROM ethereum.transactions
WHERE block_time >= NOW() - INTERVAL '1' DAY
ORDER BY gas_price DESC
LIMIT 100

-- BAD: Sort without limit
SELECT hash, gas_price
FROM ethereum.transactions
ORDER BY gas_price DESC
```

### 5. Efficient JOINs with Time Filters
```sql
-- GOOD: Time filter in ON clause
SELECT t.hash, l.topic0, l.data
FROM ethereum.transactions t
INNER JOIN ethereum.logs l
    ON t.hash = l.tx_hash
    AND t.block_date = l.block_date
    AND l.block_date >= TIMESTAMP '2024-10-01'
    AND l.block_date < TIMESTAMP '2024-10-02'
WHERE t.block_date >= TIMESTAMP '2024-10-01'
  AND t.block_date < TIMESTAMP '2024-10-02'
```

### 6. Use CTEs for Complex Logic
```sql
WITH daily_volumes AS (
    SELECT
        block_date as trade_date,
        SUM(amount_usd) as daily_volume
    FROM dex.trades
    WHERE blockchain = 'ethereum'
      AND block_date >= NOW() - INTERVAL '30' DAY
    GROUP BY block_date
)
SELECT trade_date, daily_volume,
    AVG(daily_volume) OVER (
        ORDER BY trade_date
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    ) as rolling_7day_avg
FROM daily_volumes
ORDER BY trade_date DESC
```

## Debugging Tips

- Google `<problem> Trino SQL` for general SQL issues
- Check [Trino documentation](https://trino.io/docs/current/functions.html)
- Run `EXPLAIN ANALYZE <query>` to check for full table scans
- Use `SHOW FUNCTIONS` to list all available functions

## Reserved Keywords

Common SQL keywords that must be quoted when used as column names:
- `from` → `"from"`
- `to` → `"to"`
- `value` → `value` (usually OK, but quote if issues)
- `hash` → `hash` (usually OK)
- `time` → `time` (usually OK)
- `date` → `date`

```sql
-- Always quote "from" and "to"
SELECT "from", "to", value FROM ethereum.transactions
```

## Materialized Views

Pre-computed results for faster queries. Use Dune's curated tables (like `dex.trades`) which are essentially materialized views maintained by the community.
