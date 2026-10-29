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
- script de migração aditiva, dry-run, guardas de escrita e retomada idempotente;
- verificação pré-finalização de índices/telefones/slug contra alterações concorrentes, sem execução em produção;
- bootstrap de white-label básico;
- CI GitHub para lint/build/test/worker:typecheck/docs:check;
- proteção fail-closed no bootstrap da área pública, limpeza de estado quando muda o slug e remoção de fallbacks de branding/contato da Banca Ana Maria em outras bancas;
- Chromium CI para smoke browser em desktop/mobile com duas APIs fictícias, com screenshots de UI executada publicados como artefato temporário (não produção);
- suíte `tests/integration` e testes de migração incluídos no `npm test` padrão;
- job isolado de Firestore Emulator (`demo-banca`) exercitando Worker REST + Tenant A/B, Rules e migração fictícia;
- renovação de sessão por commit com precondition `updateTime`, com testes de concorrência e revogação.

Consultar `TESTING.md` para comandos e escopo das evidências automatizadas.

## Evidências automatizadas (sem acesso a dados reais)
- testes de integração de autenticação Firebase assinada e isolamento A × B;
- testes de slugs, permissões por tenant, suporte de leitura com expiração e negação de privilégios;
- testes do catálogo, cursores e chaves de idempotência tenant-scoped;
- testes de migração em gateway de memória: dry-run, colisões, retomada e falhas simultâneas;
- testes não substituem Firestore real, homologação nem execução autorizada do APPLY.

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
