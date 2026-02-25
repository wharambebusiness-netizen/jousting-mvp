// ============================================================
// Structured JSON Logger (Phase 28)
// ============================================================
// Factory pattern: createLogger(ctx) returns a logger with
// debug/info/warn/error methods that write structured JSON
// lines. Supports level filtering, child loggers with merged
// metadata, and request correlation via fromRequest().
//
// Usage:
//   const logger = createLogger({ minLevel: 'info' });
//   logger.info('server started', { port: 3100 });
//   const child = logger.child({ terminalId: 'abc' });
//   child.warn('high memory', { usage: '90%' });
// ============================================================

export const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Create a structured JSON logger.
 * @param {{ minLevel?: string, sink?: { write: Function }, meta?: object }} [ctx]
 * @returns {{ debug, info, warn, error, child, fromRequest }}
 */
export function createLogger(ctx = {}) {
  const minLevel = ctx.minLevel || 'info';
  const sink = ctx.sink || process.stderr;
  const baseMeta = ctx.meta || {};
  const minOrdinal = LOG_LEVELS[minLevel] ?? LOG_LEVELS.info;

  function write(level, msg, meta) {
    const ordinal = LOG_LEVELS[level];
    if (ordinal == null || ordinal < minOrdinal) return;

    const entry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...baseMeta,
      ...meta,
    };
    sink.write(JSON.stringify(entry) + '\n');
  }

  function debug(msg, meta) { write('debug', msg, meta); }
  function info(msg, meta) { write('info', msg, meta); }
  function warn(msg, meta) { write('warn', msg, meta); }
  function error(msg, meta) { write('error', msg, meta); }

  /**
   * Create a child logger with merged metadata.
   * @param {object} extraMeta - Metadata to merge into all log calls
   * @returns {ReturnType<typeof createLogger>}
   */
  function child(extraMeta) {
    return createLogger({
      minLevel,
      sink,
      meta: { ...baseMeta, ...extraMeta },
    });
  }

  /**
   * Create a child logger with reqId from an Express request.
   * @param {{ id: string }} req - Express request with id property
   * @returns {ReturnType<typeof createLogger>}
   */
  function fromRequest(req) {
    return child({ reqId: req.id });
  }

  return { debug, info, warn, error, child, fromRequest };
}
