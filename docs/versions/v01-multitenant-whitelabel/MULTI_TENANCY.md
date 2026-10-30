# MULTI TENANCY

## Tenant Resolver
O Worker aceita a rota canônica `/api/t/{slug}/public|client|admin/...`.

O resolver:
1. valida slug;
2. consulta `bancas`;
3. exige tenant ativo;
4. cria TenantContext;
5. injeta `bancaId` resolvido nos bindings escopados;
6. encaminha para handlers existentes.

## Compatibilidade
`BANCA_ID` pode atender temporariamente URLs legacy apenas quando configurado de forma explícita. Não é mais requisito de configuração global.

## Frontend
Rotas públicas e painel local vivem sob `/{tenantSlug}`.
O API client deriva o slug atual e envia chamadas para `/api/t/{slug}/...`.

## Isolamento
- membership local por tenant;
- sessão de cliente valida `bancaId`;
- índice de telefone v2 incorpora tenant;
- cache público usa URL com slug;
- jobs iteram tenants ativos.

## Tenant A
Banca Ana Maria deve ser preservada pela migração aditiva.

## Tenant B
Deve existir como fixture/emulator/teste, nunca como dado fictício injetado automaticamente em produção.
