# MIGRATION

## Objetivo
Preservar Banca Ana Maria como Tenant A sem apagar dados.

Script:
`npm run migrate:multitenant`

Variáveis:
- FIREBASE_PROJECT_ID;
- BANCA_ID = documento existente da banca;
- TENANT_SLUG;
- CLIENT_SESSION_PEPPER;
- APPLY=1 somente após revisar dry-run.

## Comportamento
Dry-run é padrão.

A migração:
- confirma a banca existente;
- prepara slug/status;
- consulta clientes do tenant;
- cria índices de telefone v2 tenant-scoped;
- recusa colisão;
- preserva índices/registros legacy;
- não apaga histórico.

## Ordem de produção
1. backup/garantia de preservação conforme operação;
2. dry-run;
3. revisar contagens;
4. APPLY=1;
5. validar Tenant A;
6. somente então retirar compatibilidade legacy em etapa posterior.

Nenhuma migração de produção foi executada por esta documentação.
