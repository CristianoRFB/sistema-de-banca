# DATA MODEL

## Tenant
`bancas/{bancaId}` representa também o tenant.

Campos relevantes:
- slug;
- nomeExibicao;
- ativo;
- branding;
- contatos/configuração/horários.

## Membership local
`bancas/{bancaId}/usuarios/{uid}`

Papéis:
- TENANT_OWNER;
- STAFF;
- ADMIN (legado compatível);
- OPERADOR (legado compatível).

## Platform Owner
`platformOwners/{uid}`

É autorização global e não papel local da banca.

## Dados operacionais
Catálogo, listas, reservas, repartes, notificações e históricos continuam escopados por `bancaId`.

## Cliente
O índice de telefone v2 usa HMAC incluindo `bancaId`, permitindo o mesmo telefone em tenants diferentes.

## Auditoria
Novas ações globais usam `auditLogs`; históricos do domínio existente são preservados.
