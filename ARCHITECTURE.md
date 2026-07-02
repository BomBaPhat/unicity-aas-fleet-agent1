# AAS-FleetAgent Architecture Documentation

## System Design Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     AAS-FleetAgent                          │
│                   (Main Agent Loop)                         │
└─────────────────────────────────────────────────────────────┘
           ↓              ↓              ↓              ↓
    ┌────────────┐ ┌─────────────┐ ┌─────────┐ ┌──────────────┐
    │  Market    │ │ Arbitrage   │ │Executor │ │    Risk      │
    │ Listener   │ │   Engine    │ │         │ │  Manager     │
    └────────────┘ └─────────────┘ └─────────┘ └──────────────┘
         ↓              ↓              ↓              ↓
    Nostr Relays   Intent Pool    Sphere SDK    Agent Health
```

## Module Interaction Diagram

```
1. DISCOVERY PHASE
   ┌──────────────────┐
   │ Nostr Relays     │
   │ (WebSocket)      │
   └────────┬─────────┘
            │ Events (kind: 1, 23194)
            ↓
   ┌──────────────────┐
   │ MarketListener   │
   │ • Validates sigs │
   │ • Parses intents │
   │ • Caches active  │
   └────────┬─────────┘
            │ intent:received
            ↓

2. ANALYSIS PHASE
   ┌──────────────────────┐
   │ ArbitrageEngine      │
   │ • Add to pool        │
   │ • Find pairs (A↔B)   │
   │ • Calc profit        │
   │ • Risk scoring       │
   └────────┬─────────────┘
            │ opportunity:identified
            ↓

3. EXECUTION PHASE
   ┌──────────────────────┐
   │ Executor             │
   │ • Sign intents       │
   │ • Lock escrow        │
   │ • Wait settlement    │
   │ • Execute swaps      │
   │ • Settle escrow      │
   └────────┬─────────────┘
            │ execution:completed/failed
            ↓

4. MONITORING PHASE
   ┌──────────────────────┐
   │ RiskManager          │
   │ • Record success     │
   │ • Track balance      │
   │ • Audit trail        │
   │ • Health checks      │
   │ • Emergency shutdown │
   └──────────────────────┘
```

## Data Structures

### Intent Pool (In-Memory)
```typescript
intentPool: Map<string, MarketIntent> = {
  "nostr-abc123": {
    offeredAsset: { token: "USDC", amount: 1000 },
    requestedAsset: { token: "ETH", amount: 0.5 },
    rate: 0.0005,
    expiresAt: 1704067200000,
    publisherNametag: "@alice"
  },
  "nostr-def456": { ... }
}
```

### Opportunity Cache (In-Memory)
```typescript
opportunityCache: Map<string, ArbitrageOpportunity> = {
  "opp-xyz789": {
    intentA: MarketIntent,
    intentB: MarketIntent,
    profitMargin: 3.2,        // %
    netProfit: 2.8,           // after gas
    riskScore: 42,            // 0-100
    expiresAt: 1704067200000
  }
}
```

### Active Positions (In-Memory + Persistent)
```typescript
activePositions: Map<string, ActivePosition> = {
  "pos-qrs012": {
    escrowAddress: "0x...",
    status: "locked",         // pending|locked|settled|failed
    collateral: 1000,
    expectedReturn: 0.5,
    escrowLockTime: 1704067100,
    createdAt: 1704067100000
  }
}
```

### Execution Events (Log File)
```json
{
  "id": "evt-123",
  "type": "opportunity_identified",
  "opportunityId": "opp-xyz789",
  "data": {
    "profitMargin": 3.2,
    "intentA": { ... },
    "intentB": { ... }
  },
  "timestamp": 1704067100000
}
```

## Event-Driven Architecture

### Event Emission

```typescript
// 1. Market Listener → Arbitrage Engine
marketListener.emit("intent:received", intent);

// 2. Arbitrage Engine → Executor
arbitrageEngine.emit("opportunity:identified", opportunity);

// 3. Executor → Risk Manager
executor.emit("execution:completed", result);
executor.emit("execution:failed", result);

// 4. Risk Manager → Agent
riskManager.emit("balance:critical", data);
riskManager.emit("health:degraded", data);
riskManager.emit("agent:shutdown", data);
```

### Event Listener Registration

```typescript
// In agent/index.ts setupEventListeners()
marketListener.on("intent:received", (intent) => {
  arbitrageEngine.addIntent(intent);
});

arbitrageEngine.on("opportunity:identified", async (opportunity) => {
  const result = await executor.executeArbitrage(opportunity);
  riskManager.recordSuccess(result.profit);
});

riskManager.on("agent:shutdown", async () => {
  await agent.shutdown();
});
```

## Process Flow Diagrams

### Atomic Swap Execution Flow

```
                    EXECUTOR
┌─────────────────────────────────────────────┐
│                                             │
│  Step 1: Initialize                         │
│  ├─ Load wallet from mnemonic               │
│  ├─ Get current balance                     │
│  └─ Verify opportunity feasibility          │
│         ↓                                   │
│  Step 2: Sign Intent A                      │
│  ├─ wallet.signIntent(                      │
│  │   offered: intentA.offeredAsset,         │
│  │   requested: intentA.requestedAsset      │
│  │ )                                        │
│  └─ Return: signature + intentHash          │
│         ↓                                   │
│  Step 3: Lock Escrow                        │
│  ├─ wallet.escrow.lock(                     │
│  │   amount: collateral,                    │
│  │   counterparty: intentA.publisher,       │
│  │   timeout: 300s                          │
│  │ )                                        │
│  └─ Return: escrowAddress + txHash          │
│         ↓                                   │
│  Step 4: Wait for Settlement (Poll)         │
│  ├─ while (!escrow.settled) {               │
│  │   state = wallet.escrow.getState()       │
│  │   if (timeout) throw TimeoutError        │
│  │   sleep(1000)                            │
│  │ }                                        │
│  └─ Return: settlementTxHash                │
│         ↓                                   │
│  Step 5: Execute Swap B                     │
│  ├─ signIntent(intentB)                     │
│  ├─ wallet.executeSwap(                     │
│  │   signedIntent,                          │
│  │   counterparty: intentB.publisher         │
│  │ )                                        │
│  └─ Return: amountReceived + txHash         │
│         ↓                                   │
│  Step 6: Settle Escrow                      │
│  ├─ wallet.escrow.settle(                   │
│  │   escrowAddress,                         │
│  │   proofOfCompletion: swapBTx              │
│  │ )                                        │
│  └─ Return: finalTxHash                     │
│         ↓                                   │
│  SUCCESS: Position settled, profit claimed  │
│                                             │
└─────────────────────────────────────────────┘
```

### Timeout Recovery Flow

```
                    EXECUTOR
┌─────────────────────────────────────────────┐
│  Active Position: status = "locked"         │
│  Escrow Timeout: 300 seconds                │
│                                             │
│  Main Loop (every 1s):                      │
│  ├─ timeRemaining = getTimeRemaining()      │
│  ├─ if (timeRemaining == 0)                 │
│  │    triggerRecovery()                     │
│  └─ sleep(1000)                             │
│         ↓                                   │
│  Recovery Phase:                            │
│  ├─ Check escrow.settled == false           │
│  ├─ wallet.escrow.recover(escrowAddress)    │
│  ├─ Position status = "failed"              │
│  └─ Emit: execution:failed                  │
│         ↓                                   │
│  Risk Manager:                              │
│  ├─ recordError()                           │
│  └─ logExecutionEvent(type: "timeout_recovery")
│                                             │
└─────────────────────────────────────────────┘
```

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Add intent to pool | O(1) | Hash map insertion |
| Find arbitrage pairs | O(n) | Linear scan of pool |
| Calculate profit | O(1) | Simple math |
| Escrow state poll | O(1) | Single RPC call |
| Execute atomic swap | O(1) | Single transaction |

### Space Complexity

| Data Structure | Complexity | Capacity |
|---|---|---|
| Intent Pool | O(n) | ~10,000 intents (10 min expiry) |
| Opportunity Cache | O(m) | ~1,000 opportunities (5 min expiry) |
| Active Positions | O(p) | Max 5 concurrent (configurable) |
| Execution Events | O(h) | Trimmed to last 1,000 events |

### Throughput

**Conservative Estimate (Testnet v2):**
- Intent discovery rate: 100-500 intents/minute
- Opportunity identification rate: 10-50 opportunities/minute
- Execution rate: 1-5 atomic swaps/minute
- Success rate: 90-95% (with timeout recovery)

## Security Considerations

### Signature Verification

```typescript
// Nostr event validation
- Verify SHA256 hash (event.id)
- Validate signature against pubkey
- Check timestamp freshness (not >1 hour old)
- Reject unsigned events

// Intent signature
- Verify Sphere SDK signed intent format
- Validate counterparty identity
- Check nonce is fresh
- Reject replay attacks
```

### Escrow Verification

```typescript
- Verify escrow contract code hash matches expected
- Validate settlement conditions are unambiguous
- Enforce timeout boundaries
- Check counterparty is known/trusted
- Monitor for escrow exploit patterns
```

### Wallet Security

```typescript
- Mnemonic never stored in plaintext
- Use AES-256-GCM encryption for wallet data
- Implement wallet locking after timeout
- Require password for withdrawal operations
- Audit all signing events
```

## Failure Modes & Recovery

### Mode 1: Escrow Timeout
- **Trigger:** No settlement after 300s
- **Impact:** Locked collateral
- **Recovery:** Auto-release via escrow.recover() after timeout
- **Audit:** Log timeout_recovery event

### Mode 2: Balance Depletion
- **Trigger:** Balance < STOP_LOSS_THRESHOLD
- **Impact:** Cannot execute new swaps
- **Recovery:** Emergency liquidation of all positions
- **Audit:** Log balance:critical event

### Mode 3: High Error Rate
- **Trigger:** >10 errors per 10 minutes
- **Impact:** Agent becomes unstable
- **Recovery:** Pause agent, investigate root cause
- **Audit:** Log health:degraded event

### Mode 4: Position Limit Reached
- **Trigger:** 5+ concurrent active positions
- **Impact:** Cannot take new opportunities
- **Recovery:** Wait for position settlement
- **Audit:** Log position:limit_reached event

## Integration Points with Sphere SDK

### Required SDK Methods

```typescript
// Wallet Management
Sphere.Agent.create(config) → Agent
agent.wallet.getState() → WalletState
agent.wallet.getBalance() → Record<token, amount>

// Intent Operations
wallet.signIntent(intentData) → SignedIntent
wallet.validateIntent(intent) → boolean

// Escrow Primitives
wallet.escrow.lock(lockData) → EscrowTx
wallet.escrow.getState(address) → EscrowState
wallet.escrow.settle(settleData) → SettleTx
wallet.escrow.recover(address) → RecoveryTx

// Swap Execution
wallet.executeSwap(swapData) → SwapTx

// Gas Estimation
wallet.estimateGas(tx) → gasUnits
wallet.getGasPrice() → gasPrice
```

### Expected Sphere SDK Behavior

1. **Deterministic Signing:** Same input always produces same signature
2. **Atomic Operations:** Escrow lock + settlement cannot be interrupted
3. **Timeout Guarantee:** Escrow auto-releases after N seconds
4. **Nonce Management:** Auto-increments to prevent replay
5. **Balance Consistency:** Real-time balance updates after settlement

## Deployment Architecture

### Local Development
```
┌─────────────────────────┐
│  AAS-FleetAgent Process │
│  ├─ MarketListener      │
│  ├─ ArbitrageEngine     │
│  ├─ Executor            │
│  └─ RiskManager         │
├─ logs/agent.log        │
└─ .env (local)          │
```

### Docker Container (Single)
```
┌────────────────────────┐
│  Docker Container      │
│  ├─ AAS-FleetAgent     │
│  ├─ Node.js 18         │
│  └─ 512 MB RAM limit   │
├─ Logs volume: ./logs   │
└─ Network: docker-net   │
```

### AstridOS Sandbox
```
┌──────────────────────────┐
│  AstridOS Microkernel    │
│  ┌────────────────────┐  │
│  │ Sandbox Container  │  │
│  │ ├─ Memory: 512 MB  │  │
│  │ ├─ CPU: 1.0 share  │  │
│  │ └─ Process isolate │  │
│  │                    │  │
│  │ AAS-FleetAgent     │  │
│  │ ├─ logs (tmpfs)    │  │
│  │ └─ .env (ro-bind)  │  │
│  └────────────────────┘  │
└──────────────────────────┘
```

---

**For implementation details, see README.md**