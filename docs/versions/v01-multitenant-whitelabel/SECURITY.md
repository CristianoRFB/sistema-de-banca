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
- `platform_owner` NÃO obtém acesso automático às APIs operacionais da banca: requer membership local ativa, atribuída explicitamente e auditada pela administração global;
- suporte temporário com consentimento e prazo limitado ainda não está implementado, portanto não deve ser anunciado como funcional.
- sessão de cliente precisa pertencer à mesma banca;
- dados privados não podem cruzar tenants.

## Cliente
Tokens continuam opacos/HMAC. O índice de telefone v2 incorpora o tenant.

## Secrets
Service account e `CLIENT_SESSION_PEPPER` não entram no Git.

## Comercial
Segurança, isolamento, integridade e autorização não dependem de plano Premium.
