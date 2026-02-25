// ============================================================
// OpenAPI Routes (Phase 44)
// ============================================================
// Serves the generated OpenAPI 3.0.3 spec and Swagger UI docs.
//
// Endpoints (both skip auth):
//   GET /api/openapi.json  — returns OpenAPI spec as JSON
//   GET /api/docs          — serves Swagger UI HTML page
// ============================================================

import { Router } from 'express';

/**
 * Create OpenAPI documentation routes.
 * @param {object} ctx
 * @param {object} ctx.openApiGenerator - Generator from createOpenApiGenerator()
 * @returns {Router}
 */
export function createOpenApiRoutes(ctx) {
  const { openApiGenerator } = ctx;
  const router = Router();

  // OpenAPI spec as JSON
  router.get('/openapi.json', (_req, res) => {
    try {
      const spec = openApiGenerator.generate();
      res.json(spec);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Swagger UI docs page
  router.get('/docs', (_req, res) => {
    res.type('text/html').send(`<!DOCTYPE html>
<html><head><title>API Docs</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui.css">
</head><body>
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui' })</script>
</body></html>`);
  });

  return router;
}
