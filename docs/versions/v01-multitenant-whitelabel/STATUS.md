# STATUS — v01 Multi-Tenant White-Label

## Implementado na branch
- Tenant Resolver canônico em `/api/t/<tenant-slug>/...`;
- Request/TenantContext no Worker;
- compatibilidade legacy opcional via BANCA_ID;
- cron jobs por tenants ativos;
- rotas frontend por slug;
- cache público tenant-scoped, incluindo bootstrap de identidade em modo offline (sem cache de APIs privadas);
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

## Incremento de segurança — 2026-10-30
- Sessão persistente de cliente isolada por slug (chave v2); sair de uma banca não encerra a sessão de outra.
- Migração de chave local v1 exclusivamente para Banca Ana Maria, preservando sessões legadas válidas sem expô-las em outro tenant.
- TenantAdminGate compara UID autenticado com UID da verificação de membership; troca de conta nunca reaproveita um gate liberado anteriormente.
- Slugs explícitos inválidos não herdam silenciosamente a Banca Ana Maria nas rotas públicas, login local e painel.
- Novos testes unitários de isolamento de sessão, migração, troca de UID e slug inválido.
- Os testes e builds desse incremento só contam como validados após CI verde no SHA correspondente, não pela mera publicação dos commits.

## Incremento de governança — 2026-10-31
- API do Platform Owner lista memberships por página (50 por padrão, máximo 100), ordenadas por documento, com cursor exclusivo reconstruído no servidor dentro do caminho do tenant.
- UI permite carregar mais memberships sem perder as anteriores e limpa a lista ao mudar de tenant, inclusive se uma consulta falhar.
- Link de suporte não utiliza mais o tenant padrão quando o tenant selecionado não é encontrado.
- Branding do AdminShell só é aplicado se o bootstrap corresponder ao slug ativo e estiver habilitado, sem exibir visual de outra banca durante navegação.
- Suporte temporário desmonta o painel e bloqueia o conteúdo já renderizado quando a concessão expira; expiração ausente ou inválida não concede acesso, mesmo com flag de override.
- Testes de regressão cobrem 255 memberships, escopo de cursor e limites, paginação na UI, troca de banca com falha e branding administrativo divergente.
- Os resultados desta rodada dependem do CI verde no último SHA; commits anteriores não provam o estado mais recente.

## Incremento de auditoria consultável — 2026-10-31
- API `GET /api/platform/audit` protegida por `requirePlatformOwner`, somente leitura, com paginação (20 a 50 registros por página) e filtro opcional `tenantId`.
- Ordenação por `createdAt DESC` e `__name__ DESC`, cursor exclusivo reconstruído no Worker; o backend não devolve o campo interno `details` na listagem.
- Painel global inclui eventos de criação/ativação de tenants, memberships e concessões/revogações de suporte; filtro e paginação descartam respostas obsoletas.
- Dois índices compostos de `auditLogs` adicionados em `firestore.indexes.json`, incluindo consulta global e filtrada por tenant. **Necessário publicar os índices no ambiente real antes de usar a nova consulta**.
- Testes unitários de API (paginações, filtro e validação) e interface (filtro, respostas antigas e recuperação de erro).
- O console global monta novamente ao mudar o UID Firebase autenticado, descartando listas, filtros e histórico de auditoria da identidade anterior.
- Auditoria de ações **não** é auditoria por leitura individual; concessão de suporte não representa consentimento separado da banca.

## Incremento de provisionamento atômico — 2026-10-31
- Criação de novos tenants exige `initialOwnerUid` explícito; não existe promoção automática do criador, e-mail ou conta de teste.
- Worker grava banca, membership `TENANT_OWNER` ativa, reserva de slug `tenantSlugs/{slug}` e dois eventos de auditoria na **mesma transação**.
- Pré-verificação preserva compatibilidade com slugs de bancas existentes antes da introdução do registro; a reserva de slug usa precondition `mustNotExist` como defesa contra criações concorrentes.
- Painel solicita o UID Firebase Auth do responsável antes de permitir criar a banca.
- Testes cobrem sucesso, ausência/invalidade de UID, slug existente (com e sem reserva), falha de commit sem estado parcial e repetição do mesmo slug.
- **Limite operacional:** o Worker verifica o formato do UID, mas **não** comprova que ele já existe no Firebase Auth nem que o titular aceitou o convite; contas/consentimento reais devem ser verificados em homologação.
- Novas bancas não são criadas em produção por esta alteração. Dados preexistentes e migração da Ana Maria continuam preservados.
- Painel do Platform Owner descarta consultas de memberships e concessões de suporte de seleções de tenant anteriores, inclusive quando o servidor responde fora de ordem; testes com respostas atrasadas de A e B.
- Ações de alteração de usuários/suporte ficam indisponíveis enquanto os acessos do tenant selecionado são carregados, sem impedir alternar de banca.

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
