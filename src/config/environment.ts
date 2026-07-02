import dotenv from "dotenv";
import {
  AgentConfig,
  MarketConfig,
  NostrConfig,
  RiskConfig,
} from "./types.js";

dotenv.config();

const getEnvVar = (key: string, defaultValue?: string): string => {
  const value = process.env[key];
  if (!value && !defaultValue) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue || "";
};

const getEnvNumber = (key: string, defaultValue?: number): number => {
  const value = process.env[key];
  if (value === undefined && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value ? parseInt(value, 10) : defaultValue || 0;
};

const getEnvBoolean = (key: string, defaultValue: boolean = false): boolean => {
  const value = process.env[key];
  return value ? value.toLowerCase() === "true" : defaultValue;
};

const getEnvJsonArray = (key: string, defaultValue: unknown[] = []): unknown[] => {
  const value = process.env[key];
  if (!value) return defaultValue;
  try {
    return JSON.parse(value);
  } catch {
    console.warn(`Failed to parse JSON for ${key}, using default`);
    return defaultValue;
  }
};

/**
 * Load and validate all environment configuration
 */
export const loadConfig = (): {
  agent: AgentConfig;
  market: MarketConfig;
  nostr: NostrConfig;
  risk: RiskConfig;
  logging: {
    level: string;
    format: string;
    toFile: boolean;
    filePath: string;
  };
  astridos: {
    sandboxMode: boolean;
    memoryLimitMb: number;
    cpuShares: number;
    processIsolationEnabled: boolean;
  };
} => {
  const config = {
    agent: {
      nametag: getEnvVar("AGENT_NAMETAG"),
      mnemonic: getEnvVar("AGENT_MNEMONIC"),
      walletPassword: getEnvVar("AGENT_WALLET_PASSWORD"),
      rpcUrl: getEnvVar("UNICITY_RPC_URL"),
      chainId: getEnvNumber("UNICITY_CHAIN_ID", 9999),
      network: (getEnvVar("UNICITY_NETWORK", "testnet2") as "testnet2" | "mainnet"),
    } as AgentConfig,

    market: {
      minProfitMarginPercent: getEnvNumber("MIN_PROFIT_MARGIN_PERCENT", 2.5),
      maxPositionSizeTokens: getEnvNumber("MAX_POSITION_SIZE_TOKENS", 10000),
      stopLossThreshold: getEnvNumber("STOP_LOSS_THRESHOLD", 500),
      escrowTimeoutSeconds: getEnvNumber("ESCROW_TIMEOUT_SECONDS", 300),
      maxConcurrentPositions: getEnvNumber("MAX_CONCURRENT_POSITIONS", 5),
      gasBufferPercent: getEnvNumber("GAS_BUFFER_PERCENT", 15),
    } as MarketConfig,

    nostr: {
      relayUrls: getEnvJsonArray("NOSTR_RELAY_URLS", [
        "wss://relay.unicity.network",
      ]) as string[],
      filterKinds: getEnvJsonArray("NOSTR_FILTER_KINDS", [1, 23194]) as number[],
      subscriptionId: getEnvVar("NOSTR_SUBSCRIPTION_ID", "aas-fleet-agent-sub"),
    } as NostrConfig,

    risk: {
      enableAutoLiquidation: getEnvBoolean("ENABLE_AUTO_LIQUIDATION", true),
      enableTimeoutRecovery: getEnvBoolean("ENABLE_TIMEOUT_RECOVERY", true),
    } as RiskConfig,

    logging: {
      level: getEnvVar("LOG_LEVEL", "info"),
      format: getEnvVar("LOG_FORMAT", "json"),
      toFile: getEnvBoolean("LOG_TO_FILE", true),
      filePath: getEnvVar("LOG_FILE_PATH", "./logs/agent.log"),
    },

    astridos: {
      sandboxMode: getEnvBoolean("ASTRIDOS_SANDBOX_MODE", true),
      memoryLimitMb: getEnvNumber("ASTRIDOS_MEMORY_LIMIT_MB", 512),
      cpuShares: getEnvNumber("ASTRIDOS_CPU_SHARES", 1024),
      processIsolationEnabled: getEnvBoolean("PROCESS_ISOLATION_ENABLED", true),
    },
  };

  validateConfig(config);
  return config;
};

/**
 * Validate configuration for critical values
 */
const validateConfig = (config: ReturnType<typeof loadConfig>): void => {
  if (config.market.minProfitMarginPercent < 0.5) {
    throw new Error("Min profit margin must be at least 0.5%");
  }

  if (config.market.stopLossThreshold <= 0) {
    throw new Error("Stop loss threshold must be positive");
  }

  if (config.market.escrowTimeoutSeconds < 60) {
    throw new Error("Escrow timeout must be at least 60 seconds");
  }

  if (config.nostr.relayUrls.length === 0) {
    throw new Error("At least one Nostr relay URL must be configured");
  }
};

// Export singleton
export const config = loadConfig();