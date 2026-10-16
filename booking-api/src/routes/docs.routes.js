// ---------------------------------------------------------------------------
// DOCS ROUTES  (V2.10 → Part XI)
//
// Serves the OpenAPI spec as JSON plus a zero-dependency browsable UI (Swagger
// UI loaded from a CDN, so we don't vendor it). Public: an API contract is meant
// to be read by the people integrating with you.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { openapiSpec } from '../docs/openapi.js';

export const docsRouter = Router();

docsRouter.get('/openapi.json', (_req, res) => {
  res.json(openapiSpec);
});

docsRouter.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html>
  <head>
    <title>Booking API — docs</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => SwaggerUIBundle({ url: '/docs/openapi.json', dom_id: '#ui' });
    </script>
  </body>
</html>`);
});
