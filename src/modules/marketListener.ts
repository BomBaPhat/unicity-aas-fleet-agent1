import { EventEmitter } from "events";
import { config } from "../config/environment.js";
import { MarketIntent } from "../config/types.js";
import { logger } from "../utils/logger.js";
import { isValidNostrSignature } from "../utils/helpers.js";

/**
 * NostrMarketListener
 * Continuously listens to Nostr relays for market intents (trade offers).
 * 
 * Integration Points:
 * - NOSTR_RELAY_URLS: WebSocket connections to Nostr relays
 * - Event Kind 23194: Unicity-specific intent events (or custom kind)
 * - Subscription filters: Decode and emit MarketIntent objects
 */
export class NostrMarketListener extends EventEmitter {
  private relayConnections: Map<string, WebSocket> = new Map();
  private isListening: boolean = false;
  private intentCache: Map<string, MarketIntent> = new Map();
  private subscriptionId: string;

  constructor() {
    super();
    this.subscriptionId = config.nostr.subscriptionId;
  }

  /**
   * Start listening to all configured Nostr relays
   */
  async start(): Promise<void> {
    logger.info("Starting NostrMarketListener", {
      relays: config.nostr.relayUrls,
      subscriptionId: this.subscriptionId,
    });

    try {
      // TODO: Connect to Nostr relays using nostr-tools
      // Implementation placeholder:
      for (const relayUrl of config.nostr.relayUrls) {
        await this.connectToRelay(relayUrl);
      }

      this.isListening = true;
      this.emit("listener:started");
      logger.info("NostrMarketListener started successfully");
    } catch (error) {
      logger.error("Failed to start NostrMarketListener", error);
      throw error;
    }
  }

  /**
   * Connect to a single Nostr relay via WebSocket
   * TODO: Implement using nostr-tools Relay class
   */
  private async connectToRelay(relayUrl: string): Promise<void> {
    logger.debug("Connecting to Nostr relay", { relayUrl });

    try {
      // Placeholder for actual WebSocket/Nostr connection
      // Expected implementation:
      // const relay = await Relay.connect(relayUrl);
      // relay.subscribe(subscriptionId, this.buildFilters());
      // relay.on('event', (event) => this.handleNostrEvent(event));
      // relay.on('eose', () => this.handleEndOfStoredEvents());
      // this.relayConnections.set(relayUrl, relay);

      logger.info("Connected to Nostr relay", { relayUrl });
    } catch (error) {
      logger.warn("Failed to connect to relay", error, { relayUrl });
    }
  }

  /**
   * Build Nostr subscription filters for intent discovery
   * Filters for specific event kinds (intents, payment requests)
   */
  private buildFilters(): Record<string, unknown>[] {
    return [
      {
        kinds: config.nostr.filterKinds, // e.g., [1, 23194]
        // Optional: limit: 100, // Recent events only
      },
    ];
  }

  /**
   * Handle incoming Nostr event (raw event from relay)
   * Decode and validate, then emit as MarketIntent
   */
  private handleNostrEvent(rawEvent: Record<string, unknown>): void {
    try {
      const intent = this.parseNostrEventAsIntent(rawEvent);

      if (!intent) {
        logger.debug("Skipped event (not a valid intent)", { eventId: rawEvent.id });
        return;
      }

      // Check for duplicates
      if (this.intentCache.has(intent.id)) {
        logger.debug("Duplicate intent received", { intentId: intent.id });
        return;
      }

      // Cache the intent
      this.intentCache.set(intent.id, intent);

      // Emit for arbitrage engine to process
      this.emit("intent:received", intent);
      logger.debug("Market intent received", { intentId: intent.id });
    } catch (error) {
      logger.warn("Error processing Nostr event", error, {
        eventId: rawEvent.id,
      });
    }
  }

  /**
   * Parse raw Nostr event into MarketIntent structure
   * 
   * Expected Nostr event structure (JSON):
   * {
   *   "id": "event_hash",
   *   "pubkey": "publisher_public_key",
   *   "created_at": timestamp,
   *   "kind": 23194,
   *   "tags": [
   *     ["nametag", "alice"],
   *     ["offered", "token_a", "100"],
   *     ["requested", "token_b", "110"],
   *     ["expires", "timestamp"]
   *   ],
   *   "content": "Market intent description",
   *   "sig": "signature_hex"
   * }
   */
  private parseNostrEventAsIntent(event: Record<string, unknown>): MarketIntent | null {
    try {
      const tags = event.tags as string[][];
      const pubkey = event.pubkey as string;
      const id = event.id as string;
      const sig = event.sig as string;
      const createdAt = event.created_at as number;

      // Validate signature
      if (!isValidNostrSignature(id, sig, pubkey)) {
        logger.warn("Invalid Nostr event signature", { eventId: id });
        return null;
      }

      // Extract tags
      let nametag: string | undefined;
      let offeredAsset: { token: string; amount: number } | null = null;
      let requestedAsset: { token: string; amount: number } | null = null;
      let expiresAt: number | null = null;

      for (const tag of tags) {
        if (tag[0] === "nametag" && tag[1]) {
          nametag = tag[1];
        } else if (tag[0] === "offered" && tag[1] && tag[2]) {
          offeredAsset = {
            token: tag[1],
            amount: parseFloat(tag[2]),
          };
        } else if (tag[0] === "requested" && tag[1] && tag[2]) {
          requestedAsset = {
            token: tag[1],
            amount: parseFloat(tag[2]),
          };
        } else if (tag[0] === "expires" && tag[1]) {
          expiresAt = parseInt(tag[1], 10);
        }
      }

      if (!offeredAsset || !requestedAsset) {
        logger.warn("Missing asset tags in Nostr event", { eventId: id });
        return null;
      }

      const rate = requestedAsset.amount / offeredAsset.amount;

      return {
        id: `nostr-${id}`,
        publisherId: pubkey,
        publisherNametag: nametag,
        offeredAsset,
        requestedAsset,
        rate,
        timestamp: createdAt * 1000, // Convert to milliseconds
        expiresAt: expiresAt ? expiresAt * 1000 : createdAt * 1000 + 3600 * 1000, // Default 1 hour
        nostrEventId: id,
        nostrSignature: sig,
      };
    } catch (error) {
      logger.debug("Failed to parse Nostr event as intent", error);
      return null;
    }
  }

  /**
   * Handle end of stored events (EOSE) from relay
   * Signals that real-time subscriptions are ready
   */
  private handleEndOfStoredEvents(): void {
    logger.debug("Received EOSE (End of Stored Events)");
    this.emit("relay:eose");
  }

  /**
   * Get cached intents (recent market activity)
   */
  getCachedIntents(): MarketIntent[] {
    const now = Date.now();
    const activeIntents = Array.from(this.intentCache.values()).filter(
      (intent) => intent.expiresAt > now
    );

    // Cleanup expired intents
    for (const [id, intent] of this.intentCache.entries()) {
      if (intent.expiresAt <= now) {
        this.intentCache.delete(id);
      }
    }

    return activeIntents;
  }

  /**
   * Stop listening and close relay connections
   */
  async stop(): Promise<void> {
    logger.info("Stopping NostrMarketListener");

    try {
      // TODO: Close all Nostr relay connections
      // Expected implementation:
      // for (const relay of this.relayConnections.values()) {
      //   relay.close();
      // }

      this.relayConnections.clear();
      this.isListening = false;
      this.emit("listener:stopped");
      logger.info("NostrMarketListener stopped");
    } catch (error) {
      logger.error("Error stopping NostrMarketListener", error);
    }
  }

  /**
   * Check if listener is active
   */
  getStatus(): { isListening: boolean; connectedRelays: number; cachedIntents: number } {
    return {
      isListening: this.isListening,
      connectedRelays: this.relayConnections.size,
      cachedIntents: this.intentCache.size,
    };
  }
}

export const marketListener = new NostrMarketListener();