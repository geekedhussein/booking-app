// ---------------------------------------------------------------------------
// OPENAPI SPEC  (V2.10 → Part XI: API documentation)
//
// A machine-readable contract for the API. Because it's structured data (not
// prose) it can drive interactive docs, generate client SDKs, and power contract
// tests. Served at /docs/openapi.json, with a browsable UI at /docs.
//
// Kept code-first (defined here alongside the app) so it ships with the code;
// the discipline is to update it in the same PR as any route change.
// ---------------------------------------------------------------------------

// Every id is a MongoDB ObjectId, sent and received as a 24-character hex string.
const objectId = {
  type: 'string',
  pattern: '^[a-f0-9]{24}$',
  example: '6650c3f2a1b2c3d4e5f60718',
};
const idParam = { name: 'id', in: 'path', required: true, schema: objectId };

const errorResponse = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'array', items: { type: 'object' } },
      },
    },
    requestId: { type: 'string' },
  },
};

const booking = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    resourceId: { type: 'string' },
    userId: { type: 'string' },
    startsAt: { type: 'string', example: '2026-10-01 09:00:00' },
    endsAt: { type: 'string', example: '2026-10-01 10:00:00' },
    status: {
      type: 'string',
      enum: ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'],
    },
  },
};

const resource = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    capacity: { type: 'integer' },
    isActive: { type: 'boolean' },
    minDurationMinutes: { type: 'integer' },
    maxDurationMinutes: { type: 'integer', nullable: true },
    leadTimeMinutes: { type: 'integer' },
    bufferMinutes: { type: 'integer' },
    providerId: { type: 'string', nullable: true },
    providerSlug: { type: 'string', nullable: true },
    providerName: { type: 'string', nullable: true },
  },
};

// V3: a service provider's public profile (their page lives at /p/<slug>).
const provider = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    slug: { type: 'string', example: 'dr-amelie-lee' },
    displayName: { type: 'string' },
    headline: { type: 'string' },
    calendarCount: { type: 'integer', description: 'Directory listings only' },
  },
};
const slugField = {
  type: 'string',
  pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
  minLength: 3,
  maxLength: 40,
};

const jsonBody = (schema) => ({ content: { 'application/json': { schema } } });
const ok = (schema, description = 'Success') => ({ description, ...jsonBody(schema) });
const errors = {
  400: { description: 'Validation error', ...jsonBody(errorResponse) },
  401: { description: 'Not authenticated', ...jsonBody(errorResponse) },
  403: { description: 'Not authorized', ...jsonBody(errorResponse) },
  404: { description: 'Not found', ...jsonBody(errorResponse) },
  409: { description: 'Conflict', ...jsonBody(errorResponse) },
};

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Booking API',
    version: '3.0.0',
    description:
      'Reservation system with service providers: clients book the calendars that providers own. All times are naive LOCAL wall-clock ("YYYY-MM-DD HH:MM") — no timezones.',
  },
  servers: [{ url: '/v1', description: 'Version 1' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Booking: booking,
      Resource: resource,
      Provider: provider,
      Error: errorResponse,
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/auth/register': {
      post: {
        tags: ['auth'],
        summary: 'Register as a client or a service provider',
        description:
          'accountType "provider" requires displayName and creates the public page in the same transaction. Without slug, the first free address based on the name is used. Signup can never create staff or admin accounts.',
        security: [],
        requestBody: jsonBody({
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string' },
            password: { type: 'string', minLength: 8 },
            accountType: { type: 'string', enum: ['client', 'provider'], default: 'client' },
            displayName: { type: 'string', maxLength: 80 },
            headline: { type: 'string', maxLength: 160 },
            slug: slugField,
          },
        }),
        responses: { 201: ok({ type: 'object' }, 'User + tokens'), ...errors },
      },
    },
    '/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'Log in',
        security: [],
        requestBody: jsonBody({
          type: 'object',
          required: ['email', 'password'],
          properties: { email: { type: 'string' }, password: { type: 'string' } },
        }),
        responses: { 200: ok({ type: 'object' }, 'User + tokens'), ...errors },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['auth'],
        summary: 'Rotate refresh token',
        security: [],
        requestBody: jsonBody({
          type: 'object',
          required: ['refreshToken'],
          properties: { refreshToken: { type: 'string' } },
        }),
        responses: { 200: ok({ type: 'object' }), ...errors },
      },
    },
    '/auth/me': {
      get: {
        tags: ['auth'],
        summary: 'Current user',
        responses: { 200: ok({ type: 'object' }), ...errors },
      },
    },
    '/resources': {
      get: {
        tags: ['resources'],
        summary: 'List resources',
        security: [],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 20, maximum: 100 },
          },
          {
            name: 'activeOnly',
            in: 'query',
            schema: { type: 'string', enum: ['true', 'false'] },
          },
        ],
        responses: { 200: ok({ type: 'object' }), ...errors },
      },
      post: {
        tags: ['resources'],
        summary: 'Create resource (staff)',
        requestBody: jsonBody(resource),
        responses: { 201: ok(resource), ...errors },
      },
    },
    '/resources/{id}/availability': {
      get: {
        tags: ['resources'],
        summary: 'Opening hours',
        security: [],
        parameters: [idParam],
        responses: { 200: ok({ type: 'array', items: { type: 'object' } }), ...errors },
      },
      put: {
        tags: ['resources'],
        summary: 'Replace opening hours (staff)',
        parameters: [idParam],
        requestBody: jsonBody({
          type: 'object',
          properties: {
            windows: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  dayOfWeek: { type: 'integer', minimum: 0, maximum: 6 },
                  opensAt: { type: 'string', example: '09:00' },
                  closesAt: { type: 'string', example: '17:00' },
                },
              },
            },
          },
        }),
        responses: { 200: ok({ type: 'array', items: { type: 'object' } }), ...errors },
      },
    },
    '/resources/{id}/schedule': {
      get: {
        tags: ['resources'],
        summary: 'Taken time intervals for one day (public)',
        security: [],
        parameters: [
          idParam,
          {
            name: 'date',
            in: 'query',
            required: true,
            schema: { type: 'string', example: '2026-10-01' },
          },
        ],
        responses: { 200: ok({ type: 'object' }), ...errors },
      },
    },
    '/resources/{id}/bookings': {
      get: {
        tags: ['resources'],
        summary: 'All bookings for one day (the owning provider, or staff)',
        parameters: [
          idParam,
          { name: 'date', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: ok({ type: 'array', items: booking }), ...errors },
      },
    },
    '/bookings': {
      post: {
        tags: ['bookings'],
        summary: 'Create a booking',
        description:
          'Send an optional `Idempotency-Key` header so retries return the original response instead of creating duplicates.',
        parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }],
        requestBody: jsonBody({
          type: 'object',
          required: ['resourceId', 'startsAt', 'endsAt'],
          properties: {
            resourceId: objectId,
            startsAt: { type: 'string', example: '2026-10-01 09:00' },
            endsAt: { type: 'string', example: '2026-10-01 10:00' },
          },
        }),
        responses: { 201: ok(booking), ...errors },
      },
    },
    '/bookings/me': {
      get: {
        tags: ['bookings'],
        summary: 'My bookings (cursor paginated)',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          {
            name: 'cursor',
            in: 'query',
            schema: { type: 'string' },
            description: 'Opaque cursor from the previous page',
          },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: ok({ type: 'object' }), ...errors },
      },
    },
    '/bookings/{id}': {
      patch: {
        tags: ['bookings'],
        summary: 'Reschedule',
        parameters: [idParam],
        requestBody: jsonBody({
          type: 'object',
          required: ['startsAt', 'endsAt'],
          properties: { startsAt: { type: 'string' }, endsAt: { type: 'string' } },
        }),
        responses: { 200: ok(booking), ...errors },
      },
      delete: {
        tags: ['bookings'],
        summary: 'Cancel',
        parameters: [idParam],
        responses: { 200: ok(booking), ...errors },
      },
    },
    '/bookings/{id}/audit': {
      get: {
        tags: ['bookings'],
        summary: 'Change history',
        parameters: [idParam],
        responses: { 200: ok({ type: 'array', items: { type: 'object' } }), ...errors },
      },
    },
    '/webhooks': {
      get: {
        tags: ['webhooks'],
        summary: 'List my webhooks',
        responses: { 200: ok({ type: 'array', items: { type: 'object' } }), ...errors },
      },
      post: {
        tags: ['webhooks'],
        summary: 'Register a webhook',
        description:
          'Returns the signing `secret` ONCE. Verify deliveries by recomputing HMAC-SHA256 of `${x-webhook-timestamp}.${rawBody}`.',
        requestBody: jsonBody({
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', format: 'uri' },
            eventTypes: { type: 'array', items: { type: 'string' } },
          },
        }),
        responses: { 201: ok({ type: 'object' }), ...errors },
      },
    },
    '/providers': {
      get: {
        tags: ['providers'],
        summary: 'Directory: providers with at least one calendar taking bookings',
        security: [],
        parameters: [
          {
            name: 'q',
            in: 'query',
            schema: { type: 'string' },
            description: 'Name or headline',
          },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: { 200: ok({ type: 'array', items: provider }), ...errors },
      },
    },
    '/providers/{slug}': {
      get: {
        tags: ['providers'],
        summary: "A provider's public page: profile + calendars taking bookings",
        security: [],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: slugField }],
        responses: {
          200: ok({
            allOf: [
              provider,
              { properties: { calendars: { type: 'array', items: resource } } },
            ],
          }),
          ...errors,
        },
      },
    },
    '/providers/me': {
      get: {
        tags: ['providers'],
        summary: 'My profile and every calendar I own, including paused ones (provider)',
        responses: { 200: ok(provider), ...errors },
      },
      patch: {
        tags: ['providers'],
        summary: 'Update my page (provider)',
        description: 'Changing slug breaks links that were already shared.',
        requestBody: jsonBody({
          type: 'object',
          properties: {
            displayName: { type: 'string', maxLength: 80 },
            headline: { type: 'string', maxLength: 160 },
            slug: slugField,
          },
        }),
        responses: { 200: ok(provider), ...errors },
      },
    },
    '/providers/me/bookings': {
      get: {
        tags: ['providers'],
        summary:
          "Bookings on all of my calendars, soonest first, with the client's email (provider)",
        parameters: [
          {
            name: 'from',
            in: 'query',
            schema: { type: 'string', example: '2026-10-09' },
            description: 'Default today',
          },
          {
            name: 'to',
            in: 'query',
            schema: { type: 'string' },
            description: 'Default from + 30 days',
          },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: ok({ type: 'array', items: booking }), ...errors },
      },
    },
  },
};
