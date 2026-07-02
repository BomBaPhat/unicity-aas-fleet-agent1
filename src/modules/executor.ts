import { EventEmitter } from "events";
import { config } from "../config/environment.js";
import {
  ActivePosition,
  ExecutionResult,
  ArbitrageOpportunity,
  WalletState,
} from "../config/types.js";
import { logger } from "../utils/logger.js";
import {
  generateId,
  retryWithBackoff,
  isEscrowExpired,
  getTimeRemainingBeforeEscrowExpiry,
} from "../utils/helpers.js";

/**
 * Executor
 * Manages atomic swap execution via Sphere SDK primitives.
 *
 * Workflow:
 * 1. Receive ArbitrageOpportunity
 * 2. Initialize wallet (if not already done)
 * 3. Create signed Intent for first swap
 * 4. Lock collateral in Escrow
 * 5. Monitor escrow state for settlement or timeout
 * 6. Execute second swap upon first settlement
 * 7. Track profit and emit result
 *
 * Integration Points:
 * - Sphere SDK: wallet.create(), wallet.getBalance(), intent.sign()
 * - Escrow mechanism: escrow.lock(), escrow.settle(), escrow.recover()
 */
export class Executor extends EventEmitter {
  private walletState: WalletState | null = null;
  private activePositions: Map<string, ActivePosition> = new Map();
  private executionHistory: ExecutionResult[] = [];
  private isInitialized: boolean = false;

  constructor() {
    super();
  }

  /**
   * Initialize executor with wallet from Sphere SDK
   * TODO: Integrate with Sphere SDK
   *
   * Expected implementation:
   * ```
   * import { Sphere } from 'sphere-sdk';
   *
   * const agent = await Sphere.Agent.create({
   *   network: config.agent.network,
   *   mnemonic: config.agent.mnemonic
   * });
   *
   * this.wallet = agent.wallet;
   * this.walletState = await this.wallet.getState();
   * ```
   */
  async initialize(): Promise<void> {
    logger.info("Initializing Executor with Sphere SDK wallet");

    try {
      // TODO: Sphere SDK initialization
      // 1. Create or recover wallet from mnemonic
      // 2. Set nametag/identity
      // 3. Query initial balance
      // 4. Store wallet reference

      this.isInitialized = true;
      this.emit("executor:initialized");
      logger.info("Executor initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize Executor", error);
      throw error;
    }
  }

  /**
   * Execute arbitrage opportunity as atomic swap
   */
  async executeArbitrage(
    opportunity: ArbitrageOpportunity
  ): Promise<ExecutionResult> {
    const executionStartTime = Date.now();
    const positionId = generateId();

    logger.info("Starting arbitrage execution", {
      opportunityId: opportunity.id,
      positionId,
      profitMargin: opportunity.profitMargin,
    });

    try {
      // Validate pre-conditions
      await this.validateExecutionConditions(opportunity);

      // Create active position
      const position: ActivePosition = {
        id: positionId,
        opportunityId: opportunity.id,
        intentAId: opportunity.intentA.id,
        intentBId: opportunity.intentB.id,
        escrowAddress: "", // Will be set after escrow creation
        escrowLockTime: Math.floor(Date.now() / 1000),
        collateralAmount: opportunity.intentA.offeredAsset.amount,
        collateralToken: opportunity.intentA.offeredAsset.token,
        expectedReturnAmount: opportunity.intentB.offeredAsset.amount,
        expectedReturnToken: opportunity.intentB.offeredAsset.token,
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      this.activePositions.set(positionId, position);

      // Step 1: Sign Intent for first swap (intentA)
      const intentASigned = await this.signIntent(
        opportunity.intentA,
        "swap_request"
      );

      // Step 2: Create escrow and lock collateral
      const escrowResult = await this.lockEscrow(
        position,
        opportunity.intentA.publisherId
      );
      position.escrowAddress = escrowResult.escrowAddress;
      position.status = "locked";

      // Step 3: Wait for first swap settlement
      const settlementResult = await this.waitForSettlement(position);

      if (!settlementResult.settled) {
        throw new Error("First swap settlement timeout");
      }

      // Step 4: Execute second swap (intentB)
      const intentBSigned = await this.signIntent(
        opportunity.intentB,
        "swap_completion"
      );

      const secondSwapResult = await this.executeSwap(
        intentBSigned,
        opportunity.intentB.publisherId
      );

      // Step 5: Settle escrow
      const finalSettlement = await this.settleEscrow(position, secondSwapResult);

      position.status = "settled";
      position.updatedAt = Date.now();

      const result: ExecutionResult = {
        success: true,
        positionId,
        txHash: settlementResult.txHash,
        escrowTxHash: escrowResult.txHash,
        settlementTxHash: finalSettlement.txHash,
        profit: opportunity.netProfit,
        gasFeeActual: opportunity.estimatedGasFee,
        executionTimeMs: Date.now() - executionStartTime,
        timestamp: Date.now(),
      };

      this.executionHistory.push(result);
      this.emit("execution:completed", result);
      logger.info("Arbitrage execution completed successfully", {
        positionId,
        profit: opportunity.netProfit,
        executionTimeMs: result.executionTimeMs,
      });

      return result;
    } catch (error) {
      logger.error("Arbitrage execution failed", error, { positionId });

      const position = this.activePositions.get(positionId);
      if (position) {
        position.status = "failed";
        position.error = error instanceof Error ? error.message : String(error);
        position.updatedAt = Date.now();

        // Attempt recovery if enabled
        if (config.risk.enableTimeoutRecovery) {
          await this.recoverFailedPosition(position);
        }
      }

      const result: ExecutionResult = {
        success: false,
        positionId,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: Date.now() - executionStartTime,
        timestamp: Date.now(),
      };

      this.executionHistory.push(result);
      this.emit("execution:failed", result);

      return result;
    }
  }

  /**
   * Validate execution conditions before proceeding
   */
  private async validateExecutionConditions(
    opportunity: ArbitrageOpportunity
  ): Promise<void> {
    // TODO: Implement Sphere SDK checks:
    // 1. Verify wallet balance >= opportunity.intentA.offeredAsset.amount
    // 2. Check that both intents are still valid (not cancelled)
    // 3. Verify escrow contract is available
    // 4. Ensure gas buffer available for fees

    if (!this.isInitialized) {
      throw new Error("Executor not initialized");
    }

    if (this.activePositions.size >= config.market.maxConcurrentPositions) {
      throw new Error("Max concurrent positions reached");
    }

    // Placeholder for balance validation
    if (
      this.walletState &&
      this.walletState.balances[opportunity.intentA.offeredAsset.token] <
        opportunity.intentA.offeredAsset.amount
    ) {
      throw new Error("Insufficient balance for position");
    }
  }

  /**
   * Sign an Intent using Sphere SDK
   * TODO: Integrate with Sphere SDK wallet.signIntent()
   */
  private async signIntent(
    intent: any,
    intentType: string
  ): Promise<{ signature: string; intentHash: string }> {
    logger.debug("Signing intent", { intentType, intentId: intent.id });

    try {
      // TODO: Sphere SDK implementation
      // const signedIntent = await this.wallet.signIntent({
      //   counterparty: intent.publisherId,
      //   offered: intent.offeredAsset,
      //   requested: intent.requestedAsset,
      //   nonce: this.walletState.nonce,
      //   type: intentType
      // });

      // Placeholder response
      return {
        signature: "0x" + "0".repeat(128), // Placeholder hex signature
        intentHash: intent.id,
      };
    } catch (error) {
      logger.error("Failed to sign intent", error);
      throw error;
    }
  }

  /**
   * Lock collateral in Escrow
   * TODO: Integrate with Sphere SDK escrow.lock()
   */
  private async lockEscrow(
    position: ActivePosition,
    counterpartyId: string
  ): Promise<{ escrowAddress: string; txHash: string }> {
    logger.debug("Locking escrow", {
      positionId: position.id,
      collateral: position.collateralAmount,
    });

    try {
      // TODO: Sphere SDK implementation
      // const escrowTx = await this.wallet.escrow.lock({
      //   amount: position.collateralAmount,
      //   token: position.collateralToken,
      //   counterparty: counterpartyId,
      //   timeout: config.market.escrowTimeoutSeconds,
      //   settlement: position.expectedReturnToken
      // });

      // Placeholder response
      return {
        escrowAddress: "0x" + "0".repeat(40),
        txHash: "0x" + "0".repeat(64),
      };
    } catch (error) {
      logger.error("Failed to lock escrow", error);
      throw error;
    }
  }

  /**
   * Wait for first swap settlement
   * Polls escrow state until settled or timeout
   */
  private async waitForSettlement(
    position: ActivePosition
  ): Promise<{ settled: boolean; txHash?: string }> {
    logger.debug("Waiting for escrow settlement", { positionId: position.id });

    try {
      // TODO: Sphere SDK implementation - poll escrow state
      // Expected flow:
      // 1. While not settled:
      //    - escrowState = await wallet.escrow.getState(position.escrowAddress)
      //    - if escrowState.settled: return true
      //    - if isEscrowExpired(position.escrowLockTime, timeout): throw error
      //    - sleep(1000)

      // Placeholder: assume settlement after 5 seconds
      await new Promise((resolve) => setTimeout(resolve, 5000));

      return {
        settled: true,
        txHash: "0x" + "0".repeat(64),
      };
    } catch (error) {
      logger.error("Escrow settlement wait failed", error);
      throw error;
    }
  }

  /**
   * Execute the second swap
   */
  private async executeSwap(
    signedIntent: { signature: string; intentHash: string },
    counterpartyId: string
  ): Promise<{ txHash: string; amountReceived: number }> {
    logger.debug("Executing second swap", {
      intentHash: signedIntent.intentHash,
    });

    try {
      // TODO: Sphere SDK implementation
      // const swapTx = await this.wallet.executeSwap({
      //   signedIntent: signedIntent.signature,
      //   counterparty: counterpartyId,
      //   slippage: 0.5 // Max 0.5% slippage
      // });

      // Placeholder response
      return {
        txHash: "0x" + "0".repeat(64),
        amountReceived: 100,
      };
    } catch (error) {
      logger.error("Second swap execution failed", error);
      throw error;
    }
  }

  /**
   * Settle escrow and claim profits
   */
  private async settleEscrow(
    position: ActivePosition,
    swapResult: { txHash: string; amountReceived: number }
  ): Promise<{ txHash: string }> {
    logger.debug("Settling escrow", {
      positionId: position.id,
      amountReceived: swapResult.amountReceived,
    });

    try {
      // TODO: Sphere SDK implementation
      // const settleTx = await this.wallet.escrow.settle({
      //   escrowAddress: position.escrowAddress,
      //   proofOfCompletion: swapResult.txHash
      // });

      // Placeholder response
      return {
        txHash: "0x" + "0".repeat(64),
      };
    } catch (error) {
      logger.error("Escrow settlement failed", error);
      throw error;
    }
  }

  /**
   * Recover failed position by releasing escrow
   */
  private async recoverFailedPosition(position: ActivePosition): Promise<void> {
    logger.info("Attempting recovery of failed position", {
      positionId: position.id,
    });

    try {
      // Check if escrow is expired
      if (
        isEscrowExpired(
          position.escrowLockTime,
          config.market.escrowTimeoutSeconds
        )
      ) {
        // TODO: Sphere SDK implementation
        // const recoveryTx = await this.wallet.escrow.recover({
        //   escrowAddress: position.escrowAddress
        // });

        logger.info("Position recovery successful", { positionId: position.id });
        position.status = "failed";
      } else {
        const timeRemaining = getTimeRemainingBeforeEscrowExpiry(
          position.escrowLockTime,
          config.market.escrowTimeoutSeconds
        );
        logger.warn("Cannot recover - escrow still active", {
          positionId: position.id,
          timeRemaining,
        });
      }
    } catch (error) {
      logger.error("Position recovery failed", error, {
        positionId: position.id,
      });
    }
  }

  /**
   * Monitor active positions for timeouts
   * Called periodically by main agent loop
   */
  async monitorActivePositions(): Promise<void> {
    for (const [positionId, position] of this.activePositions.entries()) {
      if (position.status === "locked") {
        const timeRemaining = getTimeRemainingBeforeEscrowExpiry(
          position.escrowLockTime,
          config.market.escrowTimeoutSeconds
        );

        if (timeRemaining === 0 && config.risk.enableTimeoutRecovery) {
          logger.warn("Position timeout detected, initiating recovery", {
            positionId,
          });
          await this.recoverFailedPosition(position);
        }
      }
    }
  }

  /**
   * Get execution history
   */
  getExecutionHistory(
    limit: number = 100
  ): ExecutionResult[] {
    return this.executionHistory.slice(-limit);
  }

  /**
   * Get active positions
   */
  getActivePositions(): ActivePosition[] {
    return Array.from(this.activePositions.values());
  }

  /**
   * Update wallet state
   */
  updateWalletState(walletState: WalletState): void {
    this.walletState = walletState;
  }
}

export const executor = new Executor();