/**
 * Global TypeScript interfaces for AAS-FleetAgent
 * Ensures type safety across all modules
 */

export interface AgentConfig {
  nametag: string;
  mnemonic: string;
  walletPassword: string;
  rpcUrl: string;
  chainId: number;
  network: "testnet2" | "mainnet";
}

export interface MarketConfig {
  minProfitMarginPercent: number;
  maxPositionSizeTokens: number;
  stopLossThreshold: number;
  escrowTimeoutSeconds: number;
  maxConcurrentPositions: number;
  gasBufferPercent: number;
}

export interface NostrConfig {
  relayUrls: string[];
  filterKinds: number[];
  subscriptionId: string;
}

export interface RiskConfig {
  enableAutoLiquidation: boolean;
  enableTimeoutRecovery: boolean;
}

/**
 * Market Intent - represents a trade offer on the Nostr network
 */
export interface MarketIntent {
  id: string;
  publisherId: string;
  publisherNametag?: string;
  offeredAsset: {
    token: string;
    amount: number;
  };
  requestedAsset: {
    token: string;
    amount: number;
  };
  rate: number; // requestedAmount / offeredAmount
  timestamp: number;
  expiresAt: number;
  nostrEventId: string;
  nostrSignature: string;
}

/**
 * Arbitrage Opportunity - identified misprice between two intents
 */
export interface ArbitrageOpportunity {
  id: string;
  intentA: MarketIntent;
  intentB: MarketIntent;
  profitMargin: number; // percentage
  estimatedGasFee: number;
  netProfit: number;
  riskScore: number; // 0-100
  executionPath: "swap_ab" | "swap_ba";
  createdAt: number;
  expiresAt: number;
}

/**
 * Active Position - tracks an ongoing atomic swap
 */
export interface ActivePosition {
  id: string;
  opportunityId: string;
  intentAId: string;
  intentBId: string;
  escrowAddress: string;
  escrowLockTime: number;
  collateralAmount: number;
  collateralToken: string;
  expectedReturnAmount: number;
  expectedReturnToken: string;
  status: "pending" | "locked" | "settled" | "failed";
  createdAt: number;
  updatedAt: number;
  error?: string;
}

/**
 * Wallet State - current agent balance and transaction history
 */
export interface WalletState {
  nametag: string;
  address: string;
  balances: Record<string, number>; // { token: balance }
  nonce: number;
  totalTransactions: number;
  lastUpdated: number;
}

/**
 * Execution Result - outcome of an atomic swap attempt
 */
export interface ExecutionResult {
  success: boolean;
  positionId: string;
  txHash?: string;
  escrowTxHash?: string;
  settlementTxHash?: string;
  profit?: number;
  error?: string;
  gasFeeActual?: number;
  executionTimeMs: number;
  timestamp: number;
}

/**
 * Agent Health Status
 */
export interface AgentHealth {
  isRunning: boolean;
  isListening: boolean;
  lastHeartbeat: number;
  activPositionsCount: number;
  pendingIntentsCount: number;
  walletBalance: Record<string, number>;
  uptime: number;
  errorsInLastHour: number;
  successfulExecutions: number;
  cumulativeProfitUSD: number;
}

/**
 * Execution Event - logged for audit trail
 */
export interface ExecutionEvent {
  id: string;
  type:
    | "intent_received"
    | "opportunity_identified"
    | "execution_started"
    | "execution_settled"
    | "execution_failed"
    | "timeout_recovery"
    | "balance_low"
    | "error";
  opportunityId?: string;
  positionId?: string;
  data: Record<string, unknown>;
  timestamp: number;
}