# DEPLOYMENT

## Topologia alvo
Um deploy compartilhado:
- Cloudflare Pages: frontend;
- Cloudflare Worker: API + cron;
- Firebase: Auth + Firestore.

Não criar deploy/Firebase/Worker separado por tenant.

## API
Produção deve usar rotas tenant-scoped:
`/api/t/{tenantSlug}/...`.

`BANCA_ID` é somente compatibilidade de transição e deve ser omitido no modelo final de produção.

## Bloqueios externos ainda reais
Esta branch não prova:
- domínio/zona Cloudflare;
- Pages publicado;
- Worker publicado;
- secrets de produção;
- service account real;
- Platform Owner provisionado;
- migração real aplicada.

Não declarar produção publicada antes dessas evidências.

## Pre-deploy
Exigir CI verde, migração revisada, Tenant A/B testados, configuração/secrets e QA de staging.
