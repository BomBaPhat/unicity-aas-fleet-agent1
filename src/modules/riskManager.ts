import { EventEmitter } from "events";
import { config } from "../config/environment.js";
import {
  ActivePosition,
  WalletState,
  AgentHealth,
  ExecutionEvent,
} from "../config/types.js";
import { logger } from "../utils/logger.js";
import { generateId } from "../utils/helpers.js";

/**
 * RiskManager
 * Monitors agent health, enforces guardrails, and triggers recovery.
 *
 * Responsibilities:
 * - Balance monitoring (stop-loss threshold)
 * - Position tracking and limits
 * - Error rate monitoring
 * - Graceful timeout handling
 * - Audit trail logging
 */
export class RiskManager extends EventEmitter {
  private walletState: WalletState | null = null;
  private activePositions: Map<string, ActivePosition> = new Map();
  private executionEvents: ExecutionEvent[] = [];
  private errorCount: number = 0;
  private successCount: number = 0;
  private cumulativeProfit: number = 0;
  private lastHealthCheckTime: number = Date.now();
  private isHealthy: boolean = true;

  constructor() {
    super();
  }

  /**
   * Update wallet state and check balance thresholds
   */
  updateWalletState(walletState: WalletState): void {
    this.walletState = walletState;

    // Check stop-loss threshold
    const mainTokenBalance = walletState.balances["UNICITY"] || 0; // Placeholder token
    if (mainTokenBalance < config.market.stopLossThreshold) {
      logger.warn("Stop-loss threshold triggered", {
        balance: mainTokenBalance,
        threshold: config.market.stopLossThreshold,
      });

      this.emit("balance:critical", {
        balance: mainTokenBalance,
        threshold: config.market.stopLossThreshold,
      });

      if (config.risk.enableAutoLiquidation) {
        this.triggerEmergencyShutdown();
      }
    }
  }

  /**
   * Update active positions tracking
   */
  updateActivePositions(positions: ActivePosition[]): void {
    this.activePositions.clear();
    for (const pos of positions) {
      this.activePositions.set(pos.id, pos);
    }
  }

  /**
   * Log execution event for audit trail
   */
  logExecutionEvent(event: ExecutionEvent): void {
    this.executionEvents.push(event);
    logger.logExecutionEvent(event);

    // Trim audit trail to last 1000 events
    if (this.executionEvents.length > 1000) {
      this.executionEvents = this.executionEvents.slice(-1000);
    }
  }

  /**
   * Track execution success
   */
  recordSuccess(profit: number): void {
    this.successCount++;
    this.cumulativeProfit += profit;

    this.logExecutionEvent({
      id: generateId(),
      type: "execution_settled",
      data: {
        profit,
        successCount: this.successCount,
        cumulativeProfit: this.cumulativeProfit,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Track execution error
   */
  recordError(error: Error | string, context?: Record<string, unknown>): void {
    this.errorCount++;

    this.logExecutionEvent({
      id: generateId(),
      type: "error",
      data: {
        error: error instanceof Error ? error.message : String(error),
        errorCount: this.errorCount,
        context,
      },
      timestamp: Date.now(),
    });

    // Check error rate (>10 errors in last 10 minutes)
    const recentErrors = this.executionEvents.filter(
      (e) =>
        e.type === "error" && e.timestamp > Date.now() - 10 * 60 * 1000
    ).length;

    if (recentErrors > 10) {
      logger.error("High error rate detected", {
        errorCount: recentErrors,
        timeWindowMinutes: 10,
      });

      this.emit("health:degraded", {
        reason: "High error rate",
        errorCount: recentErrors,
      });

      this.isHealthy = false;
    }
  }

  /**
   * Perform health check
   */
  performHealthCheck(): AgentHealth {
    const now = Date.now();
    const uptime = (now - this.lastHealthCheckTime) / 1000; // in seconds

    // Count errors in last hour
    const errorsInLastHour = this.executionEvents.filter(
      (e) => e.type === "error" && e.timestamp > now - 60 * 60 * 1000
    ).length;

    const health: AgentHealth = {
      isRunning: true,
      isListening: true, // TODO: Get from marketListener
      lastHeartbeat: now,
      activPositionsCount: this.activePositions.size,
      pendingIntentsCount: 0, // TODO: Get from arbitrageEngine
      walletBalance: this.walletState?.balances || {},
      uptime,
      errorsInLastHour,
      successfulExecutions: this.successCount,
      cumulativeProfitUSD: this.cumulativeProfit,
    };

    // Emit health status
    if (errorsInLastHour > 5 || this.activePositions.size > config.market.maxConcurrentPositions) {
      this.emit("health:check", { ...health, status: "degraded" });
      this.isHealthy = false;
    } else {
      this.emit("health:check", { ...health, status: "healthy" });
      this.isHealthy = true;
    }

    return health;
  }

  /**
   * Trigger emergency shutdown with graceful asset recovery
   */
  private triggerEmergencyShutdown(): void {
    logger.warn("Triggering emergency shutdown");

    // 1. Stop accepting new opportunities
    this.emit("agent:pause");

    // 2. Attempt to recover all active positions
    for (const [positionId, position] of this.activePositions.entries()) {
      this.logExecutionEvent({
        id: generateId(),
        type: "timeout_recovery",
        positionId,
        data: {
          reason: "Emergency shutdown",
          position: {
            status: position.status,
            createdAt: position.createdAt,
          },
        },
        timestamp: Date.now(),
      });

      logger.info("Position marked for recovery during shutdown", {
        positionId,
      });
    }

    // 3. Return all assets to main wallet
    this.logExecutionEvent({
      id: generateId(),
      type: "timeout_recovery",
      data: {
        reason: "Emergency withdrawal to main wallet",
        walletBalance: this.walletState?.balances,
      },
      timestamp: Date.now(),
    });

    this.emit("agent:shutdown", {
      reason: "Stop-loss threshold triggered",
      positionsRecovered: this.activePositions.size,
    });
  }

  /**
   * Get agent health status
   */
  getHealth(): AgentHealth {
    return this.performHealthCheck();
  }

  /**
   * Get recent audit trail
   */
  getAuditTrail(limit: number = 50): ExecutionEvent[] {
    return this.executionEvents.slice(-limit);
  }

  /**
   * Get cumulative statistics
   */
  getStats(): {
    successCount: number;
    errorCount: number;
    cumulativeProfit: number;
    successRate: number;
    isHealthy: boolean;
  } {
    const total = this.successCount + this.errorCount;
    const successRate = total > 0 ? (this.successCount / total) * 100 : 0;

    return {
      successCount: this.successCount,
      errorCount: this.errorCount,
      cumulativeProfit: this.cumulativeProfit,
      successRate,
      isHealthy: this.isHealthy,
    };
  }

  /**
   * Reset counters (testing only)
   */
  reset(): void {
    this.errorCount = 0;
    this.successCount = 0;
    this.cumulativeProfit = 0;
    this.executionEvents = [];
    this.activePositions.clear();
  }
}

export const riskManager = new RiskManager();