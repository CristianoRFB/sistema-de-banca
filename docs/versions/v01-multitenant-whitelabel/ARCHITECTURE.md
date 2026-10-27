# ARCHITECTURE

## Runtime
React/Vite/PWA → Cloudflare Worker → Firestore REST/Firebase.

O browser continua sem acesso direto aos dados privados do Firestore.

## Multi-tenancy
Rotas canônicas:
- `/{tenantSlug}/...` no frontend;
- `/api/t/{tenantSlug}/public|client|admin/...` na API.

O Worker resolve slug → documento de `bancas` → TenantContext confiável. Depois cria bindings tenant-scoped para reaproveitar handlers existentes durante a migração.

`BANCA_ID` não é mais requisito global do Worker. Ele existe somente como fallback explícito para URLs legacy durante a transição.

## Administração
- `/admin`: Platform Owner;
- `/{tenantSlug}/painel`: administração local da banca.

## Deploy alvo
Um frontend/Worker/Firebase compartilhados entre tenants. Não criar infraestrutura isolada por banca.
