# PROJECT STRUCTURE

- `src/app/`: providers, router, tenant helpers e layouts;
- `src/pages/public/`: área pública;
- `src/pages/cliente/`: cliente/reservas;
- `src/pages/admin/`: painel local;
- `src/pages/platform/`: Platform Owner;
- `src/features/`: módulos;
- `src/infra/`: API browser e Firebase Auth;
- `src/domain/`: entidades/regras;
- `cloudflare/worker/src/`: backend;
- `cloudflare/worker/src/tenant.ts`: Tenant Resolver;
- `cloudflare/worker/src/routes/`: public/client/admin/platform;
- `cloudflare/worker/src/jobs/`: jobs tenant-aware;
- `scripts/`: provisionamento, migração e docs;
- `tests/`: unit, integration, Firestore Emulator e browser smoke Chromium;
- `playwright.config.mjs`: execução do frontend Vite e screenshots de interface com API sintética;
- `docs/`: documentação canônica e histórica.

A árvore descreve a branch de implementação. Não implica deploy em produção.
