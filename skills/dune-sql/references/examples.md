# DuneSQL Query Examples

## Basic Patterns

### Ethereum Transactions
```sql
-- Recent transactions with ETH value
SELECT 
    block_time,
    hash,
    "from",
    "to",
    value / 1e18 as eth_value,
    gas_price / 1e9 as gas_gwei
FROM ethereum.transactions
WHERE block_date >= DATE '2024-01-01'
  AND block_date < DATE '2024-01-02'
  AND value > 0
ORDER BY block_time DESC
LIMIT 100
```

### ERC20 Token Transfers
```sql
-- USDC transfers (6 decimals)
SELECT 
    evt_block_time,
    "from",
    "to",
    value / 1e6 as usdc_amount
FROM erc20_ethereum.evt_Transfer
WHERE contract_address = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
  AND evt_block_time > NOW() - INTERVAL '1' DAY
ORDER BY evt_block_time DESC
LIMIT 100
```

### Wallet Activity
```sql
-- Top wallets by transaction count (7 days)
SELECT
    "from" as wallet,
    COUNT(*) as tx_count,
    SUM(value) / 1e18 as total_eth_sent,
    SUM(gas_used * gas_price) / 1e18 as total_gas_spent
FROM ethereum.transactions
WHERE block_date >= CURRENT_DATE - INTERVAL '7' DAY
GROUP BY 1
ORDER BY tx_count DESC
LIMIT 100
```

## DEX Analytics

### Daily DEX Volume by Project
```sql
SELECT
    DATE_TRUNC('day', block_time) as day,
    project,
    SUM(amount_usd) as volume_usd,
    COUNT(*) as trade_count
FROM dex.trades
WHERE blockchain = 'ethereum'
  AND block_time > NOW() - INTERVAL '30' DAY
  AND amount_usd > 0
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC
```

### Token Trading Volume
```sql
-- Top traded tokens by volume
SELECT
    token_bought_symbol,
    COUNT(*) as trades,
    SUM(amount_usd) as volume_usd,
    AVG(amount_usd) as avg_trade_size
FROM dex.trades
WHERE blockchain = 'ethereum'
  AND block_time > NOW() - INTERVAL '7' DAY
  AND amount_usd IS NOT NULL
GROUP BY 1
HAVING SUM(amount_usd) > 100000
ORDER BY volume_usd DESC
LIMIT 50
```

### Whale Trades
```sql
-- Large trades (>$100k)
SELECT
    block_time,
    project,
    token_bought_symbol,
    token_sold_symbol,
    token_bought_amount,
    token_sold_amount,
    amount_usd,
    taker,
    tx_hash
FROM dex.trades
WHERE blockchain = 'ethereum'
  AND block_time > NOW() - INTERVAL '24' HOUR
  AND amount_usd > 100000
ORDER BY amount_usd DESC
LIMIT 100
```

## NFT Analytics

### Recent NFT Sales
```sql
SELECT
    block_time,
    project,
    nft_contract_address,
    token_id,
    seller,
    buyer,
    amount_original as price_eth,
    amount_usd
FROM nft.trades
WHERE blockchain = 'ethereum'
  AND block_time > NOW() - INTERVAL '7' DAY
ORDER BY amount_usd DESC NULLS LAST
LIMIT 100
```

### Collection Volume
```sql
SELECT
    nft_contract_address,
    COUNT(*) as sales,
    SUM(amount_usd) as volume_usd,
    AVG(amount_usd) as avg_price,
    MIN(amount_usd) as floor_price
FROM nft.trades
WHERE blockchain = 'ethereum'
  AND block_time > NOW() - INTERVAL '30' DAY
  AND amount_usd > 0
GROUP BY 1
HAVING COUNT(*) > 10
ORDER BY volume_usd DESC
LIMIT 50
```

## Price Data

### Token Price History
```sql
SELECT
    timestamp,
    price,
    volume
FROM prices.day
WHERE blockchain = 'ethereum'
  AND contract_address = 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2  -- WETH
  AND timestamp > NOW() - INTERVAL '90' DAY
ORDER BY timestamp
```

### Join with Prices
```sql
-- Transfers with USD value
SELECT 
    t.evt_block_time,
    t."from",
    t."to",
    t.value / 1e18 as amount,
    t.value / 1e18 * p.price as amount_usd
FROM erc20_ethereum.evt_Transfer t
LEFT JOIN prices.hour p 
    ON p.blockchain = 'ethereum'
    AND p.contract_address = t.contract_address
    AND p.timestamp = DATE_TRUNC('hour', t.evt_block_time)
WHERE t.contract_address = 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2
  AND t.evt_block_time > NOW() - INTERVAL '1' DAY
LIMIT 100
```

## Gas Analytics

### Gas Prices by Hour
```sql
SELECT
    DATE_TRUNC('hour', block_time) as hour,
    AVG(gas_price) / 1e9 as avg_gwei,
    APPROX_PERCENTILE(gas_price / 1e9, 0.5) as median_gwei,
    APPROX_PERCENTILE(gas_price / 1e9, 0.95) as p95_gwei
FROM ethereum.transactions
WHERE block_date >= CURRENT_DATE - INTERVAL '1' DAY
GROUP BY 1
ORDER BY 1 DESC
```

### Gas Consumption by Contract
```sql
SELECT
    "to" as contract,
    COUNT(*) as tx_count,
    SUM(gas_used) as total_gas,
    AVG(gas_used) as avg_gas,
    SUM(gas_used * gas_price) / 1e18 as total_eth_spent
FROM ethereum.transactions
WHERE block_date >= CURRENT_DATE - INTERVAL '1' DAY
  AND success = true
  AND "to" IS NOT NULL
GROUP BY 1
ORDER BY total_gas DESC
LIMIT 100
```

## Raw Event Decoding

### Decode Transfer Events from Logs
```sql
-- Manual ERC20 transfer parsing
SELECT 
    tx_hash,
    contract_address as token,
    varbinary_ltrim(topic1) as "from",
    varbinary_ltrim(topic2) as "to",
    varbinary_to_uint256(data) as amount
FROM ethereum.logs
WHERE block_date = DATE '2024-01-15'
  AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
LIMIT 100
```

### Find Function Calls by Selector
```sql
-- Find calls to specific function (first 4 bytes of calldata)
SELECT *
FROM ethereum.transactions
WHERE block_date >= CURRENT_DATE - INTERVAL '1' DAY
  AND varbinary_starts_with(data, 0xa9059cbb)  -- transfer(address,uint256)
  AND success = true
LIMIT 100
```

## Window Functions

### Running Volume
```sql
WITH daily_volume AS (
    SELECT
        DATE_TRUNC('day', block_time) as day,
        SUM(amount_usd) as volume
    FROM dex.trades
    WHERE blockchain = 'ethereum'
      AND block_time > NOW() - INTERVAL '30' DAY
    GROUP BY 1
)
SELECT 
    day,
    volume,
    SUM(volume) OVER (ORDER BY day) as cumulative_volume,
    AVG(volume) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as rolling_7d_avg
FROM daily_volume
ORDER BY day
```

### Rank Tokens
```sql
WITH token_volumes AS (
    SELECT
        token_bought_symbol as token,
        SUM(amount_usd) as volume
    FROM dex.trades
    WHERE blockchain = 'ethereum'
      AND block_time > NOW() - INTERVAL '7' DAY
    GROUP BY 1
)
SELECT 
    token,
    volume,
    ROW_NUMBER() OVER (ORDER BY volume DESC) as rank,
    volume / SUM(volume) OVER () * 100 as market_share_pct
FROM token_volumes
WHERE volume > 100000
ORDER BY volume DESC
LIMIT 20
```

## Cross-Chain Queries

### Volume by Chain
```sql
SELECT
    blockchain,
    DATE_TRUNC('day', block_time) as day,
    SUM(amount_usd) as volume_usd
FROM dex.trades
WHERE block_time > NOW() - INTERVAL '7' DAY
  AND blockchain IN ('ethereum', 'arbitrum', 'base', 'optimism', 'polygon')
GROUP BY 1, 2
ORDER BY 2 DESC, 3 DESC
```

### Token Volume Across Chains
```sql
SELECT
    blockchain,
    SUM(amount_usd) as volume
FROM dex.trades
WHERE block_time > NOW() - INTERVAL '7' DAY
  AND (token_bought_symbol = 'USDC' OR token_sold_symbol = 'USDC')
GROUP BY 1
ORDER BY volume DESC
```

## Address Labels

### Identify Known Addresses
```sql
SELECT 
    t.block_time,
    t.hash,
    t."from",
    from_label.name as from_name,
    t."to",
    to_label.name as to_name,
    t.value / 1e18 as eth
FROM ethereum.transactions t
LEFT JOIN labels.all from_label 
    ON t."from" = from_label.address 
    AND from_label.blockchain = 'ethereum'
LEFT JOIN labels.all to_label 
    ON t."to" = to_label.address 
    AND to_label.blockchain = 'ethereum'
WHERE t.block_date = CURRENT_DATE
  AND t.value > 1e18  -- > 1 ETH
ORDER BY t.value DESC
LIMIT 100
```

## CTEs for Complex Analysis

### Token Holder Analysis
```sql
WITH transfers AS (
    SELECT "to" as address, value as amount
    FROM erc20_ethereum.evt_Transfer
    WHERE contract_address = 0x...  -- token address
    UNION ALL
    SELECT "from" as address, -value as amount
    FROM erc20_ethereum.evt_Transfer
    WHERE contract_address = 0x...
),
balances AS (
    SELECT address, SUM(amount) as balance
    FROM transfers
    GROUP BY 1
    HAVING SUM(amount) > 0
)
SELECT 
    address,
    balance / 1e18 as tokens,
    balance / SUM(balance) OVER () * 100 as pct_supply
FROM balances
ORDER BY balance DESC
LIMIT 100
```

### Cohort Analysis
```sql
WITH first_trade AS (
    SELECT 
        taker,
        MIN(DATE_TRUNC('week', block_time)) as cohort_week
    FROM dex.trades
    WHERE blockchain = 'ethereum'
      AND block_time > NOW() - INTERVAL '90' DAY
    GROUP BY 1
),
weekly_activity AS (
    SELECT 
        f.cohort_week,
        DATE_TRUNC('week', t.block_time) as activity_week,
        COUNT(DISTINCT t.taker) as active_users
    FROM dex.trades t
    JOIN first_trade f ON t.taker = f.taker
    WHERE t.blockchain = 'ethereum'
      AND t.block_time > NOW() - INTERVAL '90' DAY
    GROUP BY 1, 2
)
SELECT 
    cohort_week,
    activity_week,
    active_users,
    DATE_DIFF('week', cohort_week, activity_week) as weeks_since_first
FROM weekly_activity
ORDER BY 1, 2
```
