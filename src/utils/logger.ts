import pino from "pino";
import { config } from "../config/environment.js";
import { ExecutionEvent } from "../config/types.js";

/**
 * Structured logging service with Pino
 * Supports both console and file output with configurable levels
 */
class Logger {
  private logger: pino.Logger;

  constructor() {
    const pinoConfig: pino.LoggerOptions = {
      level: config.logging.level,
      transport: {
        target: config.logging.toFile ? "pino/file" : "pino-pretty",
        options:
          config.logging.toFile && config.logging.format === "json"
            ? { destination: config.logging.filePath }
            : {
                colorize: true,
                translateTime: "SYS:standard",
                ignore: "pid,hostname",
              },
      },
    };

    this.logger = pino(pinoConfig);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.logger.info(data || {}, message);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.logger.debug(data || {}, message);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.logger.warn(data || {}, message);
  }

  error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    const errorData = {
      ...(error instanceof Error && {
        errorMessage: error.message,
        errorStack: error.stack,
      }),
      ...data,
    };
    this.logger.error(errorData, message);
  }

  /**
   * Log execution events for audit trail
   */
  logExecutionEvent(event: ExecutionEvent): void {
    this.logger.info(
      {
        eventId: event.id,
        type: event.type,
        opportunityId: event.opportunityId,
        positionId: event.positionId,
        data: event.data,
      },
      `[EXECUTION_EVENT] ${event.type}`
    );
  }

  /**
   * Log performance metrics
   */
  logMetrics(
    operationName: string,
    durationMs: number,
    success: boolean,
    data?: Record<string, unknown>
  ): void {
    this.logger.info(
      {
        operation: operationName,
        durationMs,
        success,
        ...data,
      },
      `[METRICS] ${operationName}`
    );
  }
}

export const logger = new Logger();