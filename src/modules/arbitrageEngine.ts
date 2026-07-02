import { EventEmitter } from "events";
import { config } from "../config/environment.js";
import {
  MarketIntent,
  ArbitrageOpportunity,
  WalletState,
} from "../config/types.js";
import { logger } from "../utils/logger.js";
import {
  generateId,
  calculateProfitMargin,
  calculateNetProfit,
  estimateGasFee,
  isOpportunitySafe,
  calculateRiskScore,
} from "../utils/helpers.js";

/**
 * ArbitrageEngine
 * Analyzes market intents to identify profitable atomic swap opportunities.
 *
 * Strategy:
 * 1. Maintain a pool of active intents from Nostr
 * 2. For each new intent, find mismatches (inverse swaps at better rates)
 * 3. Calculate profit margin minus gas fees
 * 4. Filter by minimum profit threshold and risk parameters
 * 5. Emit opportunities to executor
 */
export class ArbitrageEngine extends EventEmitter {
  private intentPool: Map<string, MarketIntent> = new Map();
  private opportunityCache: Map<string, ArbitrageOpportunity> = new Map();
  private walletState: WalletState | null = null;
  private processingActive: boolean = false;

  constructor() {
    super();
  }

  /**
   * Add a new market intent to the pool
   */
  addIntent(intent: MarketIntent): void {
    logger.debug("Adding intent to pool", {
      intentId: intent.id,
      rate: intent.rate,
    });

    this.intentPool.set(intent.id, intent);

    // Immediately search for arbitrage pairs
    this.analyzeNewIntent(intent);
  }

  /**
   * Analyze a new intent for profitable pairs with existing intents
   */
  private analyzeNewIntent(newIntent: MarketIntent): void {
    const now = Date.now();

    // Search through pool for inverse swaps
    for (const [existingId, existingIntent] of this.intentPool.entries()) {
      // Skip if same intent or expired
      if (existingId === newIntent.id || existingIntent.expiresAt <= now) {
        continue;
      }

      // Check for matching pairs (A wants X→Y, B wants Y→X)
      const pair = this.findMatchingPair(newIntent, existingIntent);

      if (pair) {
        this.evaluateArbitrageOpportunity(pair.intentA, pair.intentB, pair.type);
      }
    }
  }

  /**
   * Find if two intents form an arbitrage pair
   */
  private findMatchingPair(
    intentA: MarketIntent,
    intentB: MarketIntent
  ): {
    intentA: MarketIntent;
    intentB: MarketIntent;
    type: "swap_ab" | "swap_ba";
  } | null {
    // Case 1: A offers X for Y, B offers Y for X
    if (
      intentA.offeredAsset.token === intentB.requestedAsset.token &&
      intentA.requestedAsset.token === intentB.offeredAsset.token
    ) {
      return { intentA, intentB, type: "swap_ab" };
    }

    // Case 2: B offers X for Y, A offers Y for X (reverse)
    if (
      intentB.offeredAsset.token === intentA.requestedAsset.token &&
      intentB.requestedAsset.token === intentA.offeredAsset.token
    ) {
      return { intentA: intentB, intentB: intentA, type: "swap_ba" };
    }

    return null;
  }

  /**
   * Evaluate profit potential of an arbitrage pair
   * Calculates the complete arbitrage trade path and risk metrics
   */
  private evaluateArbitrageOpportunity(
    intentA: MarketIntent,
    intentB: MarketIntent,
    executionPath: "swap_ab" | "swap_ba"
  ): void {
    try {
      // Calculate exchange path
      // Path: Start with 100 units of token A (offered)
      const startingAmount = 100; // Use normalized unit for comparison
      const rateA = intentA.rate;
      const rateB = intentB.rate;

      // After first swap: 100 * rate_A units of token B
      const intermediateAmount = startingAmount * rateA;

      // After second swap: 100 * rate_A * rate_B units of token A
      const finalAmount = intermediateAmount * rateB;

      // Calculate profit (normalized)
      const profitMargin = ((finalAmount - startingAmount) / startingAmount) * 100;

      // Estimate gas fees
      const gasFeeEstimate = estimateGasFee(
        2000, // Approximate transaction size for atomic swap
        1 // Gas price on Testnet v2
      );

      // Net profit
      const netProfit = calculateNetProfit(
        (profitMargin / 100) * startingAmount,
        gasFeeEstimate
      );

      // Calculate risk score
      const riskScore = calculateRiskScore(
        profitMargin,
        50, // Placeholder: counterparty reputation (needs on-chain lookup)
        intentA.expiresAt - Date.now(),
        intentB.expiresAt - Date.now()
      );

      // Check if opportunity meets minimum threshold
      if (
        profitMargin < config.market.minProfitMarginPercent ||
        !isOpportunitySafe(profitMargin, config.market.minProfitMarginPercent, riskScore)
      ) {
        logger.debug("Opportunity rejected - below threshold", {
          profitMargin,
          minThreshold: config.market.minProfitMarginPercent,
          riskScore,
        });
        return;
      }

      // Check wallet balance constraints
      if (
        this.walletState &&
        intentA.offeredAsset.amount > config.market.maxPositionSizeTokens
      ) {
        logger.warn("Opportunity rejected - exceeds position size limit", {
          offeredAmount: intentA.offeredAsset.amount,
          maxSize: config.market.maxPositionSizeTokens,
        });
        return;
      }

      // Create and emit opportunity
      const opportunity: ArbitrageOpportunity = {
        id: generateId(),
        intentA,
        intentB,
        profitMargin,
        estimatedGasFee: gasFeeEstimate,
        netProfit,
        riskScore,
        executionPath,
        createdAt: Date.now(),
        expiresAt: Math.min(intentA.expiresAt, intentB.expiresAt),
      };

      this.opportunityCache.set(opportunity.id, opportunity);
      this.emit("opportunity:identified", opportunity);

      logger.info("Arbitrage opportunity identified", {
        opportunityId: opportunity.id,
        profitMargin: profitMargin.toFixed(2) + "%",
        netProfit: netProfit.toFixed(2),
        riskScore,
      });
    } catch (error) {
      logger.error("Error evaluating arbitrage opportunity", error);
    }
  }

  /**
   * Update wallet state (balance, nonce)
   * Used to enforce position size limits
   */
  updateWalletState(walletState: WalletState): void {
    this.walletState = walletState;
    logger.debug("Wallet state updated", {
      balances: walletState.balances,
    });
  }

  /**
   * Get cached opportunities that are still valid
   */
  getCachedOpportunities(): ArbitrageOpportunity[] {
    const now = Date.now();
    const validOpportunities = Array.from(this.opportunityCache.values()).filter(
      (opp) => opp.expiresAt > now
    );

    // Cleanup expired opportunities
    for (const [id, opp] of this.opportunityCache.entries()) {
      if (opp.expiresAt <= now) {
        this.opportunityCache.delete(id);
      }
    }

    return validOpportunities;
  }

  /**
   * Get performance metrics
   */
  getMetrics(): {
    intentsInPool: number;
    opportunitiesIdentified: number;
    averageProfitMargin: number;
  } {
    const opportunities = this.getCachedOpportunities();
    const avgMargin =
      opportunities.length > 0
        ? opportunities.reduce((sum, opp) => sum + opp.profitMargin, 0) /
          opportunities.length
        : 0;

    return {
      intentsInPool: this.intentPool.size,
      opportunitiesIdentified: opportunities.length,
      averageProfitMargin: avgMargin,
    };
  }

  /**
   * Clean up expired intents from pool
   */
  cleanupExpiredIntents(): void {
    const now = Date.now();
    let removed = 0;

    for (const [id, intent] of this.intentPool.entries()) {
      if (intent.expiresAt <= now) {
        this.intentPool.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug("Cleaned up expired intents", { count: removed });
    }
  }

  /**
   * Reset engine state (useful for testing)
   */
  reset(): void {
    this.intentPool.clear();
    this.opportunityCache.clear();
    this.walletState = null;
  }
}

export const arbitrageEngine = new ArbitrageEngine();