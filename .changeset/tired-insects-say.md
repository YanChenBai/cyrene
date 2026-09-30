---
"@cyrenex/elysia": patch
"cyrenex": patch
---

Add eager initialization for singleton services.

Singleton services can now initialize eagerly, allowing applications to
prepare required services before handling requests.