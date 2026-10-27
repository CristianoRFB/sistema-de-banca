# STATUS — v01 Multi-Tenant White-Label

## Implementado na branch
- Tenant Resolver canônico em `/api/t/<tenant-slug>/...`;
- Request/TenantContext no Worker;
- compatibilidade legacy opcional via BANCA_ID;
- cron jobs por tenants ativos;
- rotas frontend por slug;
- cache público tenant-scoped;
- roles locais ADMIN/OPERADOR/TENANT_OWNER/STAFF;
- Platform Owner server-side em `platformOwners/{uid}`;
- API e console mínimo de Platform Owner;
- validação de membership antes do painel local;
- suporte temporário de leitura para Platform Owner, com expiração, revogação e auditoria de concessão/revogação (sem consentimento separado do tenant);
- índice de telefone v2 tenant-scoped;
- script de migração aditiva;
- bootstrap de white-label básico;
- CI GitHub para lint/build/test/worker:typecheck.

## Ainda não comprovado em produção
- migração real do Firestore da Banca Ana Maria;
- provisionamento real de Platform Owner;
- Tenant B persistido no Firebase de produção;
- deploy Cloudflare;
- QA visual em browser/staging;
- screenshots reais;
- custom domain.

## Estado comercial
Decisões de preços/planos já aprovadas, porém entitlements permanecem NEXT e não fazem parte desta implementação.
