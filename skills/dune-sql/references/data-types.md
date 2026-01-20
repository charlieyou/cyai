# DuneSQL Data Types Reference

## Blockchain-Specific Types

### VARBINARY (Addresses, Hashes, Calldata)
All blockchain addresses, transaction hashes, and raw data are stored as `varbinary`.

```sql
-- Addresses use 0x prefix
SELECT * FROM ethereum.transactions
WHERE "from" = 0xc8ebccc5f5689fa8659d83713341e5ad19349448

-- Transaction hashes
WHERE tx_hash = 0x3e3c558e7f723e3bb7de1d8f5f920ca206e3e878984296a2b8e6af2969003a19
```

### UINT256 (Unsigned 256-bit Integer)
- Range: 0 to 2^256 - 1
- Used for: token amounts, balances, large positive integers
- Common in EVM smart contracts

```sql
-- Create uint256 literal
SELECT UINT256 '101691398105299641525402875323276528467270701520'

-- Convert to varbinary
SELECT varbinary_ltrim(cast(UINT256 '123456789' as varbinary))
```

### INT256 (Signed 256-bit Integer)
- Range: -2^255 to 2^255 - 1
- Used for: values that can be negative (deltas, position changes)

```sql
-- Create int256 literal
SELECT INT256 '-123456789'
```

## Standard Numeric Types

| Type | Range | Use Case |
|------|-------|----------|
| `TINYINT` | -128 to 127 | Small flags |
| `SMALLINT` | -32,768 to 32,767 | Small counts |
| `INTEGER` (INT) | -2^31 to 2^31 - 1 | Block numbers, indices |
| `BIGINT` | -2^63 to 2^63 - 1 | Timestamps, large counts |
| `DECIMAL(p,s)` | Up to 38 digits | Precise calculations |
| `DOUBLE` | 64-bit float | Approximate values |

## String Types

### VARCHAR
Variable-length character data.
```sql
SELECT 'Hello world'  -- varchar(11)
SELECT varchar 'test'
```

### CHAR(n)
Fixed-length, padded with spaces.

## Date and Time Types

### DATE
Calendar date only.
```sql
SELECT DATE '2024-01-15'
```

### TIMESTAMP
Date and time without timezone (alias for `TIMESTAMP(3)`).
```sql
SELECT TIMESTAMP '2024-01-15 14:30:00'
SELECT TIMESTAMP '2024-01-15 14:30:00.123456'
```

### TIMESTAMP WITH TIME ZONE
```sql
SELECT TIMESTAMP '2024-01-15 14:30:00 UTC'
SELECT TIMESTAMP '2024-01-15 14:30:00 America/New_York'
```

### INTERVAL
```sql
SELECT INTERVAL '7' DAY
SELECT INTERVAL '3' HOUR
SELECT NOW() - INTERVAL '24' HOUR
```

## Type Conversions

### Implicit Conversions
DuneSQL automatically converts between numeric types when possible:
```sql
-- Implicit conversion to UINT256
SELECT 2 * UINT256 '1'  -- equivalent to: CAST(2 AS UINT256) * UINT256 '1'

-- INT256 > UINT256 in type hierarchy
SELECT COALESCE(1, INT256 '2')  -- resolves to INT256
```

### Explicit Casting
```sql
-- Basic cast
SELECT CAST(123 AS VARCHAR)
SELECT CAST('456' AS INTEGER)

-- Safe cast (returns NULL on failure)
SELECT TRY_CAST('abc' AS INTEGER)  -- returns NULL

-- Type inspection
SELECT typeof(123)           -- 'integer'
SELECT typeof(UINT256 '1')   -- 'uint256'
```

## Converting Token Amounts

Token amounts are stored as raw integers. Divide by `10^decimals`:

```sql
-- ETH (18 decimals)
SELECT value / 1e18 as eth_amount
FROM ethereum.transactions

-- USDC (6 decimals)
SELECT value / 1e6 as usdc_amount
FROM erc20_ethereum.evt_Transfer
WHERE contract_address = 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48

-- Using token metadata
SELECT 
    t.value / POWER(10, m.decimals) as amount,
    m.symbol
FROM erc20_ethereum.evt_Transfer t
JOIN tokens.erc20 m 
    ON t.contract_address = m.contract_address
    AND m.blockchain = 'ethereum'
```

## JSON Type

```sql
-- JSON values
SELECT JSON '{"key": "value"}'
SELECT JSON '[1, 2, 3]'
```

## Structural Types

### ARRAY
```sql
SELECT ARRAY[1, 2, 3]
SELECT ARRAY['a', 'b', 'c']
```

### MAP
```sql
SELECT MAP(ARRAY['key1', 'key2'], ARRAY[1, 2])
```

### ROW
```sql
SELECT ROW(1, 2.0, 'text')
SELECT CAST(ROW(1, 2.0) AS ROW(x BIGINT, y DOUBLE)).x
```

## Common Patterns

### Address Comparison
```sql
-- Direct comparison (preferred)
WHERE "from" = 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2

-- From string (if needed)
WHERE "from" = from_hex('c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')
```

### Handling NULL
```sql
-- COALESCE for defaults
SELECT COALESCE(amount_usd, 0)

-- Filter nulls
WHERE amount_usd IS NOT NULL
```

### Number Formatting
```sql
-- Format with commas
SELECT format('%,.2f', 1234567.89)  -- '1,234,567.89'

-- Format large numbers
SELECT format_number(1234567)  -- '1.23M'
```
