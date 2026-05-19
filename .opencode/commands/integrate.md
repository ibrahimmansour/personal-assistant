---
description: Add a new external service integration
---

Load the `service-integration` skill first.

Add a new integration for "$ARGUMENTS". Follow the complete integration pattern:

1. Create a token management helper in `src/lib/` (if the service requires auth)
2. Create an API route in `src/app/api/` with file-based caching and response normalization
3. Create a widget to display the data (load the `widget-development` skill)
4. Add required environment variables to `.env.local`
5. Document the new env vars needed

Follow the proxy-through-API-routes architecture. Never call external APIs from client components.
