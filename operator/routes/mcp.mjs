// ============================================================
// MCP Routes — HTTP Proxy for MCP JSON-RPC (Phase 66)
// ============================================================

import { Router } from 'express';

/**
 * Create MCP HTTP proxy routes.
 * @param {object} ctx
 * @param {object} ctx.mcpServer - MCP server instance
 * @returns {Router}
 */
export function createMcpRoutes(ctx) {
  const { mcpServer } = ctx;
  const router = Router();

  // POST /mcp — JSON-RPC proxy
  router.post('/mcp', (req, res) => {
    if (!mcpServer) {
      return res.status(503).json({ error: 'MCP server not available' });
    }

    const message = req.body;
    if (!message || !message.method) {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: message?.id || null,
        error: { code: -32600, message: 'Invalid request: missing method' },
      });
    }

    const response = mcpServer.processMessage(message);
    if (response) {
      res.json(response);
    } else {
      // Notification (no response expected)
      res.status(204).end();
    }
  });

  // GET /mcp/tools — tool definitions for documentation
  router.get('/mcp/tools', (_req, res) => {
    if (!mcpServer) {
      return res.status(503).json({ error: 'MCP server not available' });
    }
    res.json({ tools: mcpServer.getTools() });
  });

  return router;
}
