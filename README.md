# AAS-FleetAgent

**Autonomous Arbitrage-as-a-Service Agent for Unicity Testnet v2**

A fully autonomous TypeScript agent that discovers and executes profitable atomic swap arbitrage opportunities on the Unicity blockchain using the Sphere SDK, Nostr-based P2P discovery, and built-in escrow mechanisms.

## Features

✅ **100% Autonomous Operation** - No human-in-the-loop required  
✅ **Nostr-based Intent Discovery** - Listens for trade offers via Nostr relays  
✅ **Atomic Swap Execution** - Risk-free settlement using Sphere SDK escrow primitives  
✅ **Arbitrage Detection** - Identifies profitable mispricings in real-time  
✅ **Risk Management** - Stop-loss thresholds, position limits, timeout recovery  
✅ **Audit Trail** - Complete execution history and event logging  
✅ **AstridOS Compatible** - Designed for sandboxed microkernel deployment  

---

## Project Structure

```
aas-fleet-agent/
├── src/
│   ├── index.ts                      # Main agent orchestration
│   ├── config/
│   │   ├── environment.ts            # Configuration loader
│   │   └── types.ts                  # Global TypeScript interfaces
│   ├── modules/
│   │   ├── marketListener.ts         # Nostr relay listener (intent discovery)
│   │   ├── arbitrageEngine.ts        # Arbitrage logic & profit calculations
│   │   ├── executor.ts               # Sphere SDK wallet & escrow execution
│   │   └── riskManager.ts            # Health monitoring & guardrails
│   └── utils/
│       ├── logger.ts                 # Structured logging (Pino)
│       └── helpers.ts                # Utility functions
├── .env.example                      # Environment template
├── package.json
├── tsconfig.json
├── docker-compose.yml                # AstridOS containerization
└── README.md
```

---

## Quick Start

### Prerequisites

- Node.js 18+ (or Docker)
- Unicity Testnet v2 RPC endpoint access
- Sphere SDK mnemonic phrase (backup securely!)
- Nostr relay access (public or private)

### 1. Clone & Install

```bash
git clone https://github.com/BomBaPhat/aas-fleet-agent.git
cd aas-fleet-agent
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
# Agent identity
AGENT_NAMETAG=AAS-FleetAgent-001
AGENT_MNEMONIC=your_backup_mnemonic_here
AGENT_WALLET_PASSWORD=secure_password

# Network
UNICITY_RPC_URL=https://testnet2.unicity.network/rpc
UNICITY_NETWORK=testnet2

# Market settings
MIN_PROFIT_MARGIN_PERCENT=2.5
MAX_POSITION_SIZE_TOKENS=10000
STOP_LOSS_THRESHOLD=500

# Nostr relays
NOSTR_RELAY_URLS=["wss://relay.unicity.network"]
```

### 3. Compile TypeScript

```bash
npm run build
```

### 4. Start Agent

```bash
npm start
```

Or for development with live reloading:

```bash
npm run dev
```

---

## Deployment

### Option A: Local Development

```bash
npm run dev
```

### Option B: Docker (Recommended for AstridOS)

```bash
docker-compose up -d aas-fleet-agent
```

This launches the agent inside a containerized sandbox with:
- Memory limit: 512 MB
- CPU shares: 1024
- Process isolation enabled
- Read-only file system (except logs)

### Option C: AstridOS Microkernel

1. **Build container image:**
   ```bash
   docker build -t aas-fleet-agent .
   ```

2. **Deploy in AstridOS sandbox:**
   ```bash
   astridos-run \
     --memory-limit 512M \
     --cpu-shares 1024 \
     --process-isolation \
     aas-fleet-agent
   ```

3. **Monitor logs:**
   ```bash
   tail -f logs/agent.log
   ```

---

## Architecture & Workflow

### Data Flow

```
Nostr Relays
    ↓
[MarketListener] → Parse trade offers (intents)
    ↓
Cached Intent Pool
    ↓
[ArbitrageEngine] → Search for profitable pairs
    ↓
Identified Opportunities
    ↓
[Executor] → Lock escrow + execute swaps
    ↓
[RiskManager] → Monitor health & guardrails
```

### Module Responsibilities

#### **MarketListener** (`marketListener.ts`)
- Connects to Nostr relays via WebSocket
- Subscribes to event kinds (1, 23194 for intents)
- Validates Nostr event signatures
- Parses intent tags (offered asset, requested asset, rate, expiry)
- Emits `intent:received` events

**Integration Point:** Sphere SDK → Nostr message validation

---

#### **ArbitrageEngine** (`arbitrageEngine.ts`)
- Maintains pool of active intents
- Searches for inverse swap pairs (A→B/B→A)
- Calculates arbitrage profit: `(rate_A * rate_B - 1) * 100 %`
- Estimates gas fees (Testnet v2 specific)
- Filters by minimum profit margin and risk score
- Emits `opportunity:identified` events

**Formula:**
```
Profit% = ((finalAmount - startAmount) / startAmount) * 100
NetProfit = Profit - GasFee
RiskScore = f(profitMargin, counterpartyReputation, timeRemaining)
```

**Integration Point:** Sphere SDK → Real-time gas price lookup

---

#### **Executor** (`executor.ts`)
- Initializes wallet from Sphere SDK (mnemonic recovery)
- Signs intents (first swap request)
- Locks collateral in escrow (counterparty verification)
- Waits for first swap settlement (polls escrow state)
- Executes second swap (completes atomic swap)
- Settles escrow and claims profit
- Handles timeout recovery if settlement expires

**Atomic Swap Flow:**
```
1. Lock collateral in escrow (timeout: 5 minutes default)
2. Wait for counterparty settlement
3. If settled: execute complementary swap
4. Settle escrow with proof of completion
5. If timeout: recover collateral after expiry
```

**Integration Point:** Sphere SDK primitives:
- `wallet.create()` / `wallet.recover()`
- `intent.sign()`
- `escrow.lock()` / `escrow.settle()` / `escrow.recover()`
- `swap.execute()`

---

#### **RiskManager** (`riskManager.ts`)
- Monitors wallet balance vs. stop-loss threshold
- Tracks active positions and enforces position limits
- Counts errors in sliding time windows
- Triggers emergency shutdown if:
  - Balance drops below threshold
  - Error rate > 10 errors / 10 minutes
  - Too many concurrent positions
- Maintains audit trail of all execution events
- Logs cumulative profit and success rate

**Guardrails:**
```
- Stop-Loss: If balance < STOP_LOSS_THRESHOLD → liquidate all positions
- Position Limit: Max 5 concurrent atomic swaps
- Error Rate: >10 errors/10min → pause agent
- Escrow Timeout: Auto-recover after 5 minutes
```

---

### Event Lifecycle

#### Execution Success Path
```
[marketListener] intent:received
  ↓
[arbitrageEngine] addIntent() + analyzeNewIntent()
  ↓
[arbitrageEngine] opportunity:identified
  ↓
[executor] executeArbitrage()
  ↓
[executor] execution:completed
  ↓
[riskManager] recordSuccess() + logExecutionEvent(type: "execution_settled")
  ↓
[logger] Log profit + cumulative stats
```

#### Failure Recovery Path
```
[executor] execution:failed (or timeout)
  ↓
[executor] recoverFailedPosition()
  ↓
[executor] escrow.recover() (after timeout)
  ↓
[riskManager] recordError() + logExecutionEvent(type: "timeout_recovery")
  ↓
If error_rate_high: [riskManager] agent:shutdown
  ↓
[agent] graceful shutdown + asset recovery
```

---

## Configuration Reference

### Environment Variables

```env
# Unicity Network
UNICITY_RPC_URL=https://testnet2.unicity.network/rpc
UNICITY_CHAIN_ID=9999
UNICITY_NETWORK=testnet2

# Agent Identity (Sphere SDK)
AGENT_NAMETAG=AAS-FleetAgent-001
AGENT_MNEMONIC=12-or-24-word-recovery-phrase
AGENT_WALLET_PASSWORD=encryption-password

# Market Thresholds
MIN_PROFIT_MARGIN_PERCENT=2.5          # Minimum acceptable profit
MAX_POSITION_SIZE_TOKENS=10000         # Max per-swap size
STOP_LOSS_THRESHOLD=500                # Emergency liquidation level
ESCROW_TIMEOUT_SECONDS=300             # 5 minutes default

# Nostr Configuration
NOSTR_RELAY_URLS=["wss://relay.unicity.network"]
NOSTR_FILTER_KINDS=[1,23194]           # Event kinds to subscribe
NOSTR_SUBSCRIPTION_ID=aas-fleet-agent-sub-001

# Risk Management
ENABLE_AUTO_LIQUIDATION=true           # Trigger on balance < threshold
ENABLE_TIMEOUT_RECOVERY=true           # Auto-recover expired escrows
MAX_CONCURRENT_POSITIONS=5             # Limit active swaps
GAS_BUFFER_PERCENT=15                  # Extra gas reserve

# Logging
LOG_LEVEL=info                         # debug, info, warn, error
LOG_FORMAT=json                        # json or pretty
LOG_TO_FILE=true
LOG_FILE_PATH=./logs/agent.log

# AstridOS Sandbox
ASTRIDOS_SANDBOX_MODE=true
ASTRIDOS_MEMORY_LIMIT_MB=512
ASTRIDOS_CPU_SHARES=1024
PROCESS_ISOLATION_ENABLED=true
```

---

## Sphere SDK Integration Points

> **Note:** The following code placeholders show where Sphere SDK calls should be implemented. Refer to [sphere-sdk](https://github.com/unicity-sphere/sphere-sdk) for official API documentation.

### 1. Wallet Initialization (`executor.ts:initialize()`)

```typescript
// TODO: Replace with actual Sphere SDK
import { Sphere } from 'sphere-sdk';

const agent = await Sphere.Agent.create({
  network: config.agent.network,
  mnemonic: config.agent.mnemonic
});

this.wallet = agent.wallet;
this.walletState = await this.wallet.getState();
```

### 2. Intent Signing (`executor.ts:signIntent()`)

```typescript
// TODO: Sphere SDK implementation
const signedIntent = await this.wallet.signIntent({
  counterparty: intent.publisherId,
  offered: intent.offeredAsset,
  requested: intent.requestedAsset,
  nonce: this.walletState.nonce,
  type: "swap_request"
});
```

### 3. Escrow Locking (`executor.ts:lockEscrow()`)

```typescript
// TODO: Sphere SDK implementation
const escrowTx = await this.wallet.escrow.lock({
  amount: position.collateralAmount,
  token: position.collateralToken,
  counterparty: counterpartyId,
  timeout: config.market.escrowTimeoutSeconds,
  settlement: position.expectedReturnToken
});
```

### 4. Escrow Settlement (`executor.ts:waitForSettlement()`)

```typescript
// TODO: Sphere SDK implementation - poll escrow state
while (!settled) {
  const escrowState = await this.wallet.escrow.getState(position.escrowAddress);
  if (escrowState.settled) {
    return { settled: true, txHash: escrowState.txHash };
  }
  if (isEscrowExpired(position.escrowLockTime, timeout)) {
    throw new Error("Escrow expired");
  }
  await sleep(1000);
}
```

### 5. Swap Execution (`executor.ts:executeSwap()`)

```typescript
// TODO: Sphere SDK implementation
const swapTx = await this.wallet.executeSwap({
  signedIntent: signedIntent.signature,
  counterparty: counterpartyId,
  slippage: 0.5 // Max 0.5%
});
```

### 6. Escrow Recovery (`executor.ts:recoverFailedPosition()`)

```typescript
// TODO: Sphere SDK implementation
const recoveryTx = await this.wallet.escrow.recover({
  escrowAddress: position.escrowAddress
});
```

---

## Monitoring & Debugging

### Check Agent Status

```bash
# View live logs
tail -f logs/agent.log

# Filter by level
tail -f logs/agent.log | grep "error"

# Count events
grep -c "execution_settled" logs/agent.log
```

### Agent Metrics Endpoint (Future)

```bash
# GET http://localhost:3000/api/status
{
  "isRunning": true,
  "health": {
    "activPositionsCount": 2,
    "successfulExecutions": 42,
    "cumulativeProfitUSD": 1250.50,
    "errorsInLastHour": 0
  },
  "stats": {
    "successRate": 95.5,
    "cumulativeProfit": 1250.50
  }
}
```

### Debug Logging

Enable verbose logging by setting:

```env
LOG_LEVEL=debug
```

This will output:
- All intent parsing events
- Arbitrage calculations for every pair
- Escrow state transitions
- Gas fee estimates

---

## Testing

```bash
# Run unit tests
npm test

# Run with coverage
npm test -- --coverage

# Test specific module
npm test -- arbitrageEngine.test.ts
```

---

## Security Considerations

⚠️ **Critical:**

1. **Mnemonic Safety**
   - Never commit `.env` files to git
   - Use environment secrets in production
   - Rotate mnemonic on any suspected compromise

2. **Gas Price Protection**
   - Verify actual gas fees before execution
   - Use gas price oracle from Sphere SDK
   - Set MAX_GAS_FEE limit in config

3. **Counterparty Reputation**
   - Implement on-chain reputation tracking
   - Reject swaps with unknown publishers
   - Rate-limit swaps per counterparty

4. **Escrow Verification**
   - Validate escrow contract before locking
   - Ensure settlement conditions are unambiguous
   - Monitor for escrow exploit patterns

---

## Troubleshooting

### Agent Won't Start

```bash
# Check environment file
cat .env | grep UNICITY_RPC_URL

# Test RPC connection
curl https://testnet2.unicity.network/rpc -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"net_version","params":[],"id":1}'

# Check wallet recovery
npm run test-wallet
```

### No Opportunities Found

1. Check Nostr relay connectivity:
   ```bash
   grep "Connected to Nostr relay" logs/agent.log
   ```

2. Verify intent parsing:
   ```bash
   grep "intent:received" logs/agent.log | head -5
   ```

3. Check arbitrage filters:
   ```bash
   grep "Opportunity rejected" logs/agent.log | tail -10
   ```

### Escrow Timeout

If executions fail with timeout errors:

1. Increase `ESCROW_TIMEOUT_SECONDS`:
   ```env
   ESCROW_TIMEOUT_SECONDS=600  # 10 minutes
   ```

2. Check network latency:
   ```bash
   ping testnet2.unicity.network
   ```

3. Monitor escrow recovery:
   ```bash
   grep "timeout_recovery" logs/agent.log
   ```

---

## Performance Tuning

### For High-Frequency Arbitrage

```env
# Lower minimum profit to catch more opportunities
MIN_PROFIT_MARGIN_PERCENT=1.0

# Increase concurrent positions
MAX_CONCURRENT_POSITIONS=10

# Speed up main loop
MAIN_LOOP_INTERVAL_MS=500

# Larger position sizes
MAX_POSITION_SIZE_TOKENS=50000
```

### For Stable, Conservative Trading

```env
# Higher minimum profit threshold
MIN_PROFIT_MARGIN_PERCENT=5.0

# Fewer concurrent positions
MAX_CONCURRENT_POSITIONS=2

# Conservative position sizes
MAX_POSITION_SIZE_TOKENS=1000

# Higher risk score threshold
MAX_RISK_SCORE=50
```

---

## AstridOS Deployment Guide

### Prerequisites

- AstridOS kernel running
- Unprivileged user account
- Access to /tmp for socket communication

### 1. Build Sandboxed Image

```dockerfile
FROM node:18-alpine

WORKDIR /opt/aas-fleet-agent
COPY package*.json ./
RUN npm ci --production

COPY dist/ ./dist/
COPY .env /opt/aas-fleet-agent/.env

# Run as non-root
RUN adduser -D -s /sbin/nologin agent
USER agent

CMD ["node", "dist/index.js"]
```

### 2. Deploy in AstridOS

```bash
# Create sandbox manifest
cat > astridos-manifest.toml << 'EOF'
[sandbox]
name = "aas-fleet-agent"
image = "aas-fleet-agent:latest"

[resources]
memory = "512M"
cpu_shares = 1024

[security]
process_isolation = true
read_only_root = true
no_new_privs = true

[mounts]
"/opt/aas-fleet-agent/logs" = { target = "/logs", type = "tmpfs" }
"/opt/aas-fleet-agent/.env" = { target = "/.env", type = "ro-bind" }

[network]
enable = true
allow_outbound = ["wss://relay.unicity.network"]
EOF

# Deploy
astridos-deploy astridos-manifest.toml
```

### 3. Monitor in Sandbox

```bash
# List running sandboxes
astridos ps

# View logs
astridos logs aas-fleet-agent -f

# Resource usage
astridos stats aas-fleet-agent

# Stop gracefully
astridos stop aas-fleet-agent
```

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests for new functionality
4. Commit changes (`git commit -m 'Add amazing feature'`)
5. Push to branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

---

## License

MIT License - see LICENSE file for details

---

## Support

- **Discord:** [Unicity Labs Discord](https://discord.gg/PGzNZT5uVp)
- **GitHub Issues:** [Report bugs or feature requests](https://github.com/BomBaPhat/aas-fleet-agent/issues)
- **Sphere SDK Docs:** [github.com/unicity-sphere/sphere-sdk](https://github.com/unicity-sphere/sphere-sdk)

---

**Built with ❤️ for the Unicity Builder Program**