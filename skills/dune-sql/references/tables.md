# DuneSQL Tables Reference

## Table Categories

1. **Raw Tables**: Direct blockchain data (`ethereum.transactions`)
2. **Decoded Tables**: ABI-decoded contract events and calls (`uniswap_v3_ethereum.Pair_evt_Swap`)
3. **Curated Tables**: Community-maintained aggregated data (`dex.trades`, `nft.trades`)

## Raw EVM Tables

Available for all EVM chains. Replace `ethereum` with chain name (e.g., `base`, `arbitrum`, `polygon`).

### {chain}.transactions
All transactions on the blockchain.

| Column | Type | Description |
|--------|------|-------------|
| `block_time` | timestamp | Block timestamp |
| `block_date` | date | **Partition key** |
| `block_number` | bigint | Block number |
| `hash` | varbinary | Transaction hash |
| `"from"` | varbinary | Sender address |
| `"to"` | varbinary | Recipient address |
| `value` | uint256 | Native token amount (wei) |
| `gas_price` | uint256 | Gas price (wei) |
| `gas_used` | bigint | Gas consumed |
| `gas_limit` | bigint | Gas limit |
| `nonce` | bigint | Transaction nonce |
| `data` | varbinary | Input calldata |
| `success` | boolean | Execution success |
| `type` | varchar | Transaction type |
| `index` | bigint | Transaction index in block |

```sql
SELECT block_time, hash, "from", "to", value / 1e18 as eth_value
FROM ethereum.transactions
WHERE block_date >= DATE '2024-01-01'
  AND "to" = 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2
LIMIT 100
```

### {chain}.logs
Event logs emitted by contracts.

| Column | Type | Description |
|--------|------|-------------|
| `block_time` | timestamp | Block timestamp |
| `block_date` | date | **Partition key** |
| `block_number` | bigint | Block number |
| `tx_hash` | varbinary | Transaction hash |
| `contract_address` | varbinary | Emitting contract |
| `topic0` | varbinary | Event signature hash |
| `topic1` | varbinary | First indexed param |
| `topic2` | varbinary | Second indexed param |
| `topic3` | varbinary | Third indexed param |
| `data` | varbinary | Non-indexed event data |
| `index` | bigint | Log index in transaction |

```sql
-- Find Transfer events
SELECT tx_hash, contract_address, topic1 as "from", topic2 as "to", data
FROM ethereum.logs
WHERE block_date >= DATE '2024-01-01'
  AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
LIMIT 100
```

### {chain}.traces
Internal transactions (calls between contracts).

| Column | Type | Description |
|--------|------|-------------|
| `block_time` | timestamp | Block timestamp |
| `block_date` | date | **Partition key** |
| `tx_hash` | varbinary | Transaction hash |
| `"from"` | varbinary | Caller address |
| `"to"` | varbinary | Called address |
| `value` | uint256 | Value transferred |
| `input` | varbinary | Call input data |
| `output` | varbinary | Call output |
| `type` | varchar | call/create/delegatecall/staticcall |
| `success` | boolean | Call success |
| `trace_address` | array(bigint) | Position in call tree |

### {chain}.blocks
Block-level data.

| Column | Type | Description |
|--------|------|-------------|
| `time` | timestamp | Block timestamp |
| `number` | bigint | Block number |
| `hash` | varbinary | Block hash |
| `parent_hash` | varbinary | Parent block hash |
| `gas_used` | bigint | Total gas used |
| `gas_limit` | bigint | Block gas limit |
| `base_fee_per_gas` | uint256 | EIP-1559 base fee |
| `miner` | varbinary | Block producer |
| `size` | bigint | Block size (bytes) |

## Decoded Tables

### ERC20 Transfers: erc20_{chain}.evt_Transfer

| Column | Type | Description |
|--------|------|-------------|
| `evt_block_time` | timestamp | Event time |
| `evt_block_number` | bigint | Block number |
| `evt_tx_hash` | varbinary | Transaction hash |
| `contract_address` | varbinary | Token contract |
| `"from"` | varbinary | Sender |
| `"to"` | varbinary | Recipient |
| `value` | uint256 | Raw amount (divide by decimals) |

```sql
-- USDC transfers (6 decimals)
SELECT evt_block_time, "from", "to", value / 1e6 as amount
FROM erc20_ethereum.evt_Transfer
WHERE contract_address = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
  AND evt_block_time > NOW() - INTERVAL '1' DAY
```

### Protocol-Specific Tables
Format: `{protocol}_{chain}.{Contract}_{evt|call}_{EventOrFunction}`

```sql
-- Uniswap V3 Swaps
SELECT * FROM uniswap_v3_ethereum.Pair_evt_Swap LIMIT 10

-- Aave V3 Deposits
SELECT * FROM aave_v3_ethereum.Pool_evt_Supply LIMIT 10
```

## Curated Tables (Spellbook)

### dex.trades
All DEX trades across chains and protocols.

| Column | Type | Description |
|--------|------|-------------|
| `blockchain` | varchar | Chain name (partition key) |
| `block_time` | timestamp | Trade time |
| `block_date` | date | **Partition key** |
| `project` | varchar | DEX name (uniswap, curve, etc.) |
| `version` | varchar | Protocol version |
| `token_bought_address` | varbinary | Bought token contract |
| `token_bought_symbol` | varchar | Bought token symbol |
| `token_bought_amount` | double | Amount bought (decimal-adjusted) |
| `token_sold_address` | varbinary | Sold token contract |
| `token_sold_symbol` | varchar | Sold token symbol |
| `token_sold_amount` | double | Amount sold (decimal-adjusted) |
| `amount_usd` | double | USD value |
| `tx_hash` | varbinary | Transaction hash |
| `taker` | varbinary | Trade initiator |

```sql
SELECT 
    DATE_TRUNC('day', block_time) as day,
    project,
    SUM(amount_usd) as volume
FROM dex.trades
WHERE blockchain = 'ethereum'
  AND block_time > NOW() - INTERVAL '7' DAY
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC
```

### nft.trades
NFT marketplace trades.

| Column | Type | Description |
|--------|------|-------------|
| `blockchain` | varchar | Chain name |
| `block_time` | timestamp | Trade time |
| `block_date` | date | **Partition key** |
| `project` | varchar | Marketplace (opensea, blur, etc.) |
| `nft_contract_address` | varbinary | NFT contract |
| `token_id` | uint256 | NFT token ID |
| `buyer` | varbinary | Buyer address |
| `seller` | varbinary | Seller address |
| `amount_original` | double | Price in native currency |
| `amount_usd` | double | USD value |
| `currency_contract` | varbinary | Payment token |
| `tx_hash` | varbinary | Transaction hash |

```sql
SELECT block_time, nft_contract_address, token_id, amount_usd
FROM nft.trades
WHERE blockchain = 'ethereum'
  AND block_time > NOW() - INTERVAL '7' DAY
ORDER BY amount_usd DESC
LIMIT 100
```

### tokens.transfers
Token transfers across chains.

| Column | Type | Description |
|--------|------|-------------|
| `blockchain` | varchar | Chain name |
| `block_time` | timestamp | Transfer time |
| `block_date` | date | **Partition key** |
| `token_address` | varbinary | Token contract |
| `from_address` | varbinary | Sender |
| `to_address` | varbinary | Recipient |
| `amount_raw` | uint256 | Raw amount |
| `amount` | double | Decimal-adjusted amount |

### prices.day / prices.hour / prices.latest
Token prices.

| Column | Type | Description |
|--------|------|-------------|
| `blockchain` | varchar | Chain name |
| `contract_address` | varbinary | Token contract |
| `symbol` | varchar | Token symbol |
| `price` | double | USD price |
| `timestamp` | timestamp | Price timestamp |
| `decimals` | int | Token decimals |
| `volume` | double | Trading volume |
| `source` | varchar | Data source |

```sql
-- Get ETH price history
SELECT timestamp, price
FROM prices.day
WHERE blockchain = 'ethereum'
  AND contract_address = 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2  -- WETH
  AND timestamp > NOW() - INTERVAL '30' DAY
ORDER BY timestamp

-- Latest price
SELECT price FROM prices.latest
WHERE blockchain = 'ethereum'
  AND contract_address = 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2
```

### tokens.erc20
Token metadata.

| Column | Type | Description |
|--------|------|-------------|
| `blockchain` | varchar | Chain name |
| `contract_address` | varbinary | Token contract |
| `symbol` | varchar | Token symbol |
| `decimals` | int | Token decimals |

### labels.all
Address labels.

| Column | Type | Description |
|--------|------|-------------|
| `blockchain` | varchar | Chain name |
| `address` | varbinary | Labeled address |
| `name` | varchar | Label name |
| `category` | varchar | Label category |
| `contributor` | varchar | Who added the label |

```sql
-- Find labeled addresses in transactions
SELECT t.hash, t."from", t."to", l.name
FROM ethereum.transactions t
LEFT JOIN labels.all l 
    ON t."to" = l.address 
    AND l.blockchain = 'ethereum'
WHERE t.block_date = DATE '2024-01-15'
```

## Cross-Chain Tables

These tables have `blockchain` as a partition key. **Always filter by blockchain when possible.**

| Table | Description |
|-------|-------------|
| `dex.trades` | All DEX trades |
| `dex_aggregator.trades` | Aggregator-routed trades |
| `nft.trades` | NFT marketplace trades |
| `tokens.transfers` | Token transfers |
| `prices.day/hour/latest` | Token prices |
| `labels.all` | Address labels |

```sql
-- Cross-chain query (filter by blockchain!)
SELECT blockchain, DATE_TRUNC('day', block_time) as day, SUM(amount_usd) as volume
FROM dex.trades
WHERE block_time > NOW() - INTERVAL '7' DAY
  AND blockchain IN ('ethereum', 'arbitrum', 'base')
GROUP BY 1, 2
ORDER BY 1, 2 DESC
```

## Common Token Addresses

### Ethereum
| Token | Address |
|-------|---------|
| WETH | `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2` |
| USDC | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` |
| USDT | `0xdac17f958d2ee523a2206206994597c13d831ec7` |
| DAI | `0x6b175474e89094c44da98b954eedeac495271d0f` |
| WBTC | `0x2260fac5e5542a773aa44fbcfedf7c193bc2c599` |

### Special Addresses
| Purpose | Address |
|---------|---------|
| Null/Burn | `0x0000000000000000000000000000000000000000` |
| Dead | `0x000000000000000000000000000000000000dead` |

## Solana Tables

| Table | Description |
|-------|-------------|
| `solana.transactions` | Raw transactions |
| `dex_solana.trades` | Solana DEX trades |
| `tokens_solana.transfers` | SPL token transfers |
