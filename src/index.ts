import { marketListener } from "./modules/marketListener.js";
import { arbitrageEngine } from "./modules/arbitrageEngine.js";
import { executor } from "./modules/executor.js";
import { riskManager } from "./modules/riskManager.js";
import { config } from "./config/environment.js";
import { logger } from "./utils/logger.js";
import { sleep } from "./utils/helpers.js";

/**
 * AAS-FleetAgent
 * Autonomous Arbitrage-as-a-Service Agent for Unicity Testnet v2
 *
 * Architecture:
 * 1. MarketListener: Listens for trade intents via Nostr
 * 2. ArbitrageEngine: Analyzes pairs for profitable opportunities
 * 3. Executor: Executes atomic swaps via Sphere SDK
 * 4. RiskManager: Monitors health and enforces guardrails
 *
 * Event Flow:
 * marketListener[intent:received] → arbitrageEngine[addIntent]
 * arbitrageEngine[opportunity:identified] → riskManager[logExecutionEvent]
 * executor[executeArbitrage] → riskManager[recordSuccess/recordError]
 */

class AASFleetAgent {
  private isRunning: boolean = false;
  private mainLoopInterval: NodeJS.Timer | null = null;
  private healthCheckInterval: NodeJS.Timer | null = null;

  constructor() {
    this.setupEventListeners();
  }

  /**
   * Setup cross-module event listeners
   */
  private setupEventListeners(): void {
    // Market listener → Arbitrage engine
    marketListener.on("intent:received", (intent) => {
      arbitrageEngine.addIntent(intent);
    });

    // Arbitrage engine → Executor
    arbitrageEngine.on("opportunity:identified", async (opportunity) => {
      logger.debug("Opportunity queued for execution", {
        opportunityId: opportunity.id,
      });

      // Execute with delay to avoid race conditions
      await sleep(100);
      const result = await executor.executeArbitrage(opportunity);

      if (result.success && result.profit) {
        riskManager.recordSuccess(result.profit);
      } else {
        riskManager.recordError(
          result.error || "Unknown execution error",
          { opportunityId: opportunity.id }
        );
      }
    });

    // Executor → Risk manager
    executor.on("execution:completed", (result) => {
      logger.info("Execution completed", {
        positionId: result.positionId,
        profit: result.profit,
      });
    });

    executor.on("execution:failed", (result) => {
      riskManager.recordError(result.error || "Execution failed", {
        positionId: result.positionId,
      });
    });

    // Risk manager alerts
    riskManager.on("balance:critical", (data) => {
      logger.warn("Critical balance alert", data);
    });

    riskManager.on("health:degraded", (data) => {
      logger.warn("Agent health degraded", data);
    });

    riskManager.on("agent:shutdown", async (data) => {
      logger.error("Emergency shutdown initiated", data);
      await this.shutdown();
    });
  }

  /**
   * Start the agent
   */
  async start(): Promise<void> {
    logger.info("Starting AAS-FleetAgent", {
      nametag: config.agent.nametag,
      network: config.agent.network,
      minProfitMargin: config.market.minProfitMarginPercent,
    });

    try {
      // 1. Initialize Executor (wallet, Sphere SDK setup)
      await executor.initialize();
      logger.info("Executor initialized");

      // 2. Start market listener (Nostr relay subscriptions)
      await marketListener.start();
      logger.info("Market listener started");

      // 3. Start main loop
      this.isRunning = true;
      this.mainLoopInterval = setInterval(() => this.mainLoop(), 1000); // Check every second

      // 4. Start health check
      this.healthCheckInterval = setInterval(() => this.performHealthCheck(), 30000); // Every 30 seconds

      logger.info("AAS-FleetAgent started successfully");
      this.emit("agent:started");
    } catch (error) {
      logger.error("Failed to start AAS-FleetAgent", error);
      await this.shutdown();
      throw error;
    }
  }

  /**
   * Main agent loop
   * Runs continuously to monitor and manage execution
   */
  private async mainLoop(): Promise<void> {
    try {
      // 1. Monitor active positions for timeouts
      await executor.monitorActivePositions();

      // 2. Clean up expired intents
      arbitrageEngine.cleanupExpiredIntents();

      // 3. Log periodic metrics
      const metrics = arbitrageEngine.getMetrics();
      if (metrics.intentsInPool > 0) {
        logger.debug("Arbitrage engine metrics", metrics);
      }
    } catch (error) {
      logger.error("Error in main loop", error);
      riskManager.recordError(error as Error, { context: "mainLoop" });
    }
  }

  /**
   * Perform periodic health check
   */
  private performHealthCheck(): void {
    try {
      const health = riskManager.performHealthCheck();
      logger.debug("Agent health check", {
        activPositions: health.activPositionsCount,
        uptime: Math.floor(health.uptime),
        successRate: health.uptime,
      });
    } catch (error) {
      logger.error("Error in health check", error);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down AAS-FleetAgent");

    try {
      this.isRunning = false;

      // Stop intervals
      if (this.mainLoopInterval) clearInterval(this.mainLoopInterval);
      if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);

      // Stop market listener
      await marketListener.stop();

      // Log final statistics
      const stats = riskManager.getStats();
      logger.info("Agent shutdown complete", {
        successCount: stats.successCount,
        errorCount: stats.errorCount,
        cumulativeProfit: stats.cumulativeProfit,
        successRate: stats.successRate,
      });
    } catch (error) {
      logger.error("Error during shutdown", error);
    }
  }

  /**
   * Get current agent status
   */
  getStatus(): {
    isRunning: boolean;
    health: ReturnType<typeof riskManager.performHealthCheck>;
    stats: ReturnType<typeof riskManager.getStats>;
  } {
    return {
      isRunning: this.isRunning,
      health: riskManager.performHealthCheck(),
      stats: riskManager.getStats(),
    };
  }

  private emit(event: string, data?: unknown): void {
    logger.debug("Agent event", { event, data });
  }
}

/**
 * Agent instance and entry point
 */
const agent = new AASFleetAgent();

/**
 * Start agent on process startup
 */
async function main(): Promise<void> {
  try {
    await agent.start();

    // Log status periodically (every 60 seconds)
    setInterval(() => {
      const status = agent.getStatus();
      logger.info("Agent status report", {
        running: status.isRunning,
        activPositions: status.health.activPositionsCount,
        successfulExecutions: status.health.successfulExecutions,
        cumulativeProfit: status.health.cumulativeProfitUSD,
        errorRate:
          status.stats.errorCount /
          (status.stats.successCount + status.stats.errorCount),
      });
    }, 60000);
  } catch (error) {
    logger.error("Fatal error in main", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down gracefully");
  await agent.shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully");
  await agent.shutdown();
  process.exit(0);
});

// Start agent
main().catch((error) => {
  logger.error("Unhandled error in main", error);
  process.exit(1);
});

export { agent };