# FIREBASE STRUCTURE

Projeto histórico/oficial documentado no repositório: `banca-88851`.

## Firebase Auth
Usado para contas administrativas.

Autorização efetiva:
- Platform Owner: `platformOwners/{uid}`;
- tenant owner/staff: `bancas/{bancaId}/usuarios/{uid}`.

## Firestore
Estruturas relevantes:
- `bancas/{bancaId}`;
- `bancas/{bancaId}/usuarios/{uid}`;
- `bancas/{bancaId}/horarios/*`;
- `platformOwners/{uid}`;
- `clientes/*`;
- `indiceTelefonesClientes/*`;
- `sessoesClientes/*`;
- `listas/*`, `itensLista/*`;
- `reservas/*`, `itensReserva/*`;
- `repartes/*`, `itensReparte/*`;
- notificações e históricos;
- `auditLogs/*`.

Coleções operacionais mantêm `bancaId` quando aplicável.

## Security Rules
Acesso direto do browser: deny-all.

## Firebase Storage
**NÃO UTILIZADO NESTA VERSÃO.**

OCR/importação permanece local. O white-label usa URLs configuráveis; esta etapa não introduz Storage automaticamente.

## Emulator
Usar Emulator para Rules, fixtures e testes. Não executar testes destrutivos em produção.
