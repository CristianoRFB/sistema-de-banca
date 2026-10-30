# SECURITY

## Firestore
O browser permanece deny-all nas Security Rules. O Worker usa credencial server-side; portanto o isolamento real de tenants é obrigatório no backend.

## Tenant
Slug identifica contexto, mas não concede autorização.

Regras:
- ID vindo do frontend não define tenant;
- tenant é resolvido/validado pelo Worker;
- membership local é validada server-side;
- Platform Owner é validado em `platformOwners/{uid}`;
- `platform_owner` NÃO obtém acesso automático às APIs operacionais da banca: requer membership local ativa OU concessão temporária e explícita de suporte;
- modo de suporte é iniciado pelo Platform Owner em `/api/platform/tenants/{id}/support`, com justificativa (12–300 caracteres), duração limitada a 15/30/60 minutos e auditoria de concessão/revogação;
- concessão é restrita ao UID e tenant específicos, validada a cada requisição, expira automaticamente e permite somente operações GET no painel local; POST/PUT/PATCH/DELETE operacionais continuam proibidos sem membership local;
- o painel identifica o modo temporário como **somente leitura** e a data de expiração;
- a concessão administrativa não representa consentimento separado do titular da banca; eventual fluxo de consentimento do tenant ainda não foi implementado;
- auditoria registra concessão/revogação, mas não equivale a rastreamento individual de cada leitura de dados.
- sessão de cliente precisa pertencer à mesma banca;
- dados privados não podem cruzar tenants.

## Cliente
Tokens continuam opacos/HMAC. O índice de telefone v2 incorpora o tenant.

## Secrets
Service account e `CLIENT_SESSION_PEPPER` não entram no Git.

## Comercial
Segurança, isolamento, integridade e autorização não dependem de plano Premium.
