import { randomBytes } from 'crypto';
export const v4 = () => randomBytes(16).toString('hex');

/**
 * Generate unique IDs for opportunities, positions, and events
 */
export const generateId = (): string => {
  return uuidv4();
};

/**
 * Calculate arbitrage profit percentage
 * profit% = ((entryPrice - exitPrice) / entryPrice) * 100
 */
export const calculateProfitMargin = (
  entryPrice: number,
  exitPrice: number
): number => {
  if (entryPrice === 0) return 0;
  return ((exitPrice - entryPrice) / entryPrice) * 100;
};

/**
 * Calculate net profit after gas fees
 */
export const calculateNetProfit = (
  grossProfit: number,
  gasFee: number
): number => {
  return grossProfit - gasFee;
};

/**
 * Estimate gas fee for a transaction
 * TODO: Replace with actual Sphere SDK gas estimation
 */
export const estimateGasFee = (
  transactionSize: number,
  gasPrice: number = 1
): number => {
  // Placeholder: actual calculation depends on Unicity Testnet v2 specs
  const baseGasUnits = 21000; // Example: similar to Ethereum
  return (baseGasUnits + transactionSize * 16) * gasPrice;
};

/**
 * Validate if an opportunity is within risk parameters
 */
export const isOpportunitySafe = (
  profitMargin: number,
  minMargin: number,
  riskScore: number
): boolean => {
  return profitMargin >= minMargin && riskScore <= 75; // Risk score: 0-100
};

/**
 * Calculate risk score based on multiple factors
 * Returns 0-100 (lower = safer)
 */
export const calculateRiskScore = (
  profitMargin: number,
  counterpartyReputation: number, // 0-100
  escrowTimeRemaining: number,
  escrowTimeMax: number
): number => {
  // Time decay: higher risk as escrow expiry approaches
  const timeDecayFactor = 1 - escrowTimeRemaining / escrowTimeMax;
  const timeRiskComponent = timeDecayFactor * 30; // Max 30 points

  // Reputation inverse: unknown counterparties are riskier
  const reputationRiskComponent = (100 - counterpartyReputation) * 0.5; // Max 50 points

  // Profit margin: extreme margins are suspicious
  const marginRiskComponent = Math.max(0, Math.abs(profitMargin - 5) - 3) * 2; // 5% is optimal

  return Math.min(
    100,
    timeRiskComponent + reputationRiskComponent + marginRiskComponent
  );
};

/**
 * Format token amount with decimals
 */
export const formatTokenAmount = (
  amount: number,
  decimals: number = 18
): string => {
  return (amount / Math.pow(10, decimals)).toFixed(decimals);
};

/**
 * Parse token amount from human-readable format
 */
export const parseTokenAmount = (
  amountStr: string,
  decimals: number = 18
): number => {
  return Math.floor(parseFloat(amountStr) * Math.pow(10, decimals));
};

/**
 * Sleep for specified milliseconds (async)
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Retry a function with exponential backoff
 */
export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelayMs: number = 1000
): Promise<T> => {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (i < maxRetries - 1) {
        const delayMs = initialDelayMs * Math.pow(2, i);
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
};

/**
 * Time remaining before escrow expires (in seconds)
 */
export const getTimeRemainingBeforeEscrowExpiry = (
  escrowLockTime: number,
  escrowTimeoutSeconds: number
): number => {
  const now = Math.floor(Date.now() / 1000);
  const expiryTime = escrowLockTime + escrowTimeoutSeconds;
  return Math.max(0, expiryTime - now);
};

/**
 * Check if escrow has expired
 */
export const isEscrowExpired = (
  escrowLockTime: number,
  escrowTimeoutSeconds: number
): boolean => {
  return getTimeRemainingBeforeEscrowExpiry(escrowLockTime, escrowTimeoutSeconds) === 0;
};

/**
 * Validate Nostr event signature (basic check)
 * TODO: Use nostr-tools for full verification
 */
export const isValidNostrSignature = (
  eventId: string,
  signature: string,
  publicKey: string
): boolean => {
  // Placeholder: actual verification requires nostr-tools crypto
  if (!eventId || !signature || !publicKey) return false;
  if (signature.length !== 128) return false; // SHA256 hex = 128 chars
  return true;
};
