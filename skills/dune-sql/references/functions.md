# DuneSQL Functions Reference

## Varbinary Functions (Blockchain-Specific)

### Converting Varbinary to Numbers

```sql
-- To INTEGER (max 4 bytes)
SELECT varbinary_to_integer(varbinary_ltrim(varbinary_substring(data, 1, 32)))

-- To BIGINT (max 8 bytes)
SELECT varbinary_to_bigint(varbinary_ltrim(varbinary_substring(data, 1, 32)))

-- To DECIMAL(38,0) (max 16 bytes)
SELECT varbinary_to_decimal(varbinary_ltrim(data))

-- To UINT256 (max 32 bytes) - most common for token amounts
SELECT varbinary_to_uint256(varbinary_substring(data, 97, 32))

-- To INT256 (max 32 bytes) - for signed values
SELECT varbinary_to_int256(varbinary_substring(data, 65, 32))
```

### Converting Numbers to Varbinary
```sql
-- UINT256 to varbinary
SELECT varbinary_ltrim(cast(UINT256 '123456789' as varbinary))
```

### Varbinary Manipulation

```sql
-- Substring: varbinary_substring(data, start_byte, length_bytes)
SELECT varbinary_substring(data, 1, 32)    -- First 32 bytes
SELECT varbinary_substring(data, 33, 32)   -- Second 32 bytes
SELECT varbinary_substring(data, 13, 20)   -- Address from padded slot

-- Trim leading zeros
SELECT varbinary_ltrim(0x000000000000000000000000a2b80f9c09558945800ddf4f8786dcc8b1c44974)
-- Returns: 0xa2b80f9c09558945800ddf4f8786dcc8b1c44974

-- Trim trailing zeros
SELECT varbinary_rtrim(0xabcd00000000)

-- Length in bytes
SELECT varbinary_length(0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2)  -- 20

-- Concatenate
SELECT varbinary_concat(0xc02aaa39, 0xb223fe8d)

-- Find position (1-indexed, 0 if not found)
SELECT varbinary_position(data, 0x3d13f874)

-- Check prefix
SELECT varbinary_starts_with(data, 0x3d13f874)

-- Replace
SELECT varbinary_replace(address, 
    0x0000000000000000000000000000000000000000,  -- null address
    0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2)  -- WETH

-- Reverse
SELECT varbinary_reverse(0xabcdef)  -- 0xefcdab
```

### Keccak Hash
```sql
-- Calculate function selector
SELECT keccak(to_utf8('Transfer(address,address,uint256)'))
-- Returns: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
```

### Text Conversions
```sql
-- Varbinary to UTF-8 string
SELECT from_utf8(0x48656c6c6f20576f726c64)  -- 'Hello World'
SELECT from_utf8(varbinary_ltrim(0x0000000000006e66746e657264732e6169))

-- String to varbinary
SELECT from_hex('c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')
```

## Date and Time Functions

### Current Time
```sql
SELECT NOW()                    -- Current timestamp with timezone
SELECT current_timestamp        -- Same as NOW()
SELECT current_date             -- Current date
SELECT current_timezone()       -- e.g., 'UTC'
```

### Truncation
```sql
SELECT DATE_TRUNC('day', block_time)     -- Start of day
SELECT DATE_TRUNC('hour', block_time)    -- Start of hour
SELECT DATE_TRUNC('week', block_time)    -- Start of week (Monday)
SELECT DATE_TRUNC('month', block_time)   -- Start of month
SELECT DATE_TRUNC('year', block_time)    -- Start of year
```

### Extraction
```sql
SELECT EXTRACT(YEAR FROM block_time)
SELECT EXTRACT(MONTH FROM block_time)
SELECT EXTRACT(DAY FROM block_time)
SELECT EXTRACT(HOUR FROM block_time)

-- Convenience functions
SELECT year(block_time)
SELECT month(block_time)
SELECT day(block_time)
SELECT hour(block_time)
SELECT day_of_week(block_time)  -- 1 (Monday) to 7 (Sunday)
```

### Arithmetic
```sql
-- Add/subtract intervals
SELECT block_time + INTERVAL '1' DAY
SELECT block_time - INTERVAL '7' DAY
SELECT NOW() - INTERVAL '24' HOUR

-- Date difference
SELECT date_diff('day', start_time, end_time)
SELECT date_diff('hour', timestamp1, timestamp2)

-- Add specific units
SELECT date_add('day', 7, block_time)
SELECT date_add('hour', -24, block_time)
```

### Unix Timestamps
```sql
-- Unix timestamp to timestamp
SELECT from_unixtime(1609459200)              -- seconds
SELECT from_unixtime_nanos(1609459200000000)  -- nanoseconds

-- Timestamp to unix
SELECT to_unixtime(block_time)
```

### Formatting
```sql
SELECT date_format(block_time, '%Y-%m-%d')        -- '2024-01-15'
SELECT date_format(block_time, '%Y-%m-%d %H:%i')  -- '2024-01-15 14:30'
SELECT format_datetime(block_time, 'yyyy-MM-dd') -- JodaTime format
```

## Aggregate Functions

### Basic Aggregates
```sql
SELECT COUNT(*)                    -- Row count
SELECT COUNT(DISTINCT address)     -- Unique count
SELECT SUM(amount)                 -- Sum
SELECT AVG(gas_price)              -- Average
SELECT MIN(block_time)             -- Minimum
SELECT MAX(amount_usd)             -- Maximum
```

### Safe Sum for UINT256
```sql
-- Returns NULL on overflow instead of error
SELECT try_sum(amount)
```

### Approximate Distinct (Faster)
```sql
SELECT approx_distinct(address)  -- ~2.3% error, much faster
```

### Percentiles
```sql
SELECT approx_percentile(gas_price, 0.5)   -- Median
SELECT approx_percentile(gas_price, 0.95)  -- 95th percentile
SELECT approx_percentile(gas_price, ARRAY[0.25, 0.5, 0.75])  -- Quartiles
```

### Array Aggregation
```sql
SELECT array_agg(token_address)
SELECT array_agg(token_address ORDER BY amount DESC)
SELECT array_agg(DISTINCT token_address)
```

### Filtered Aggregation
```sql
SELECT 
    COUNT(*) as total_trades,
    COUNT(*) FILTER (WHERE amount_usd > 1000) as large_trades,
    SUM(amount_usd) FILTER (WHERE token_symbol = 'USDC') as usdc_volume
FROM dex.trades
```

### First/Last Values
```sql
SELECT 
    min_by(price, block_time) as first_price,
    max_by(price, block_time) as last_price
FROM prices.hour
WHERE contract_address = 0x...
```

## Window Functions

### Row Numbering
```sql
SELECT 
    ROW_NUMBER() OVER (ORDER BY block_time DESC) as rn,
    RANK() OVER (ORDER BY amount_usd DESC) as rank,
    DENSE_RANK() OVER (PARTITION BY token ORDER BY amount DESC) as token_rank
FROM dex.trades
```

### Running Totals
```sql
SELECT 
    block_time,
    amount_usd,
    SUM(amount_usd) OVER (ORDER BY block_time) as cumulative_volume,
    SUM(amount_usd) OVER (
        ORDER BY block_time 
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    ) as rolling_7day_volume
FROM dex.trades
```

### Lag/Lead
```sql
SELECT 
    block_time,
    price,
    LAG(price, 1) OVER (ORDER BY block_time) as prev_price,
    LEAD(price, 1) OVER (ORDER BY block_time) as next_price,
    price - LAG(price, 1) OVER (ORDER BY block_time) as price_change
FROM prices.hour
```

### First/Last in Partition
```sql
SELECT 
    FIRST_VALUE(price) OVER (PARTITION BY date ORDER BY block_time) as open_price,
    LAST_VALUE(price) OVER (
        PARTITION BY date ORDER BY block_time 
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) as close_price
FROM prices.hour
```

## String Functions

```sql
SELECT LOWER('ABC')                    -- 'abc'
SELECT UPPER('abc')                    -- 'ABC'
SELECT TRIM('  text  ')                -- 'text'
SELECT CONCAT('a', 'b', 'c')           -- 'abc'
SELECT SUBSTRING('abcdef', 2, 3)       -- 'bcd'
SELECT LENGTH('hello')                 -- 5
SELECT REPLACE('hello', 'l', 'x')      -- 'hexxo'
SELECT SPLIT('a,b,c', ',')             -- ['a', 'b', 'c']
SELECT REGEXP_LIKE('abc', '^a')        -- true
SELECT REGEXP_EXTRACT('abc123', '\d+') -- '123'
```

## Conditional Functions

```sql
-- CASE expression
SELECT CASE 
    WHEN amount_usd > 10000 THEN 'whale'
    WHEN amount_usd > 1000 THEN 'large'
    ELSE 'small'
END as trade_size

-- COALESCE (first non-null)
SELECT COALESCE(symbol, 'UNKNOWN')

-- NULLIF
SELECT NULLIF(value, 0)  -- Returns NULL if value = 0

-- IF
SELECT IF(condition, true_value, false_value)
```

## Array Functions

```sql
SELECT CARDINALITY(arr)              -- Array length
SELECT CONTAINS(arr, 'value')        -- Check membership
SELECT ARRAY_JOIN(arr, ',')          -- Join to string
SELECT ELEMENT_AT(arr, 1)            -- Get element (1-indexed)
SELECT SLICE(arr, 1, 3)              -- Subarray
SELECT ARRAY_DISTINCT(arr)           -- Remove duplicates
SELECT ARRAY_SORT(arr)               -- Sort
SELECT FILTER(arr, x -> x > 0)       -- Filter elements
SELECT TRANSFORM(arr, x -> x * 2)    -- Map function
```

## Map Functions

```sql
SELECT MAP_KEYS(m)                   -- Get keys
SELECT MAP_VALUES(m)                 -- Get values
SELECT ELEMENT_AT(m, 'key')          -- Get value by key
SELECT MAP_FILTER(m, (k,v) -> v > 0) -- Filter entries
```
