# Testes de isolamento — SaaS Banca

## Evidências locais automatizadas

O comando `npm test` executa a suíte `tests/unit/**` **e** a suíte `tests/integration/**`. A última inclui tokens Firebase assinados de teste e verificações de autorização, sessões e dados A × B.

Esses testes com fixtures em memória não são, isoladamente, prova de validação em Firestore real.

## Firestore Emulator (sem acesso à produção)

A suíte `npm run test:emulator` executa separadamente `tests/firestore/**` e `tests/emulator/**`. Ela **exige** o emulador ativo e não utiliza credenciais reais nem dados da Banca Ana Maria.

Para executar localmente, com Java 21 e Node 24:

```sh
npm ci
npx --yes firebase-tools@14.19.0 emulators:exec --only firestore --project demo-banca "npm run test:emulator"
```

O projeto `demo-banca` é fictício e não pode corresponder a um projeto de produção. O Firestore Emulator está configurado na porta 8086, em `127.0.0.1`.

O workflow de CI inclui job separado `firestore-emulator`, sem secrets, ADC ou deploy. A suíte cobre:

- Security Rules deny-all para clientes Firebase autenticados e não autenticados;
- bootstrap público da Banca A e B por consulta real no Firestore Emulator via Worker REST;
- branding e identificador distintos em cada banca;
- sessão válida no tenant original e rejeição de sessão reutilizada no outro tenant.

A comunicação com o emulador no teste REST intercepta os endpoints Google e redireciona exclusivamente para loopback. Tokens de serviço/contas RSA são gerados no processo de teste e não são credenciais reais.

## Limites da evidência

Passar no emulador **não valida automaticamente produção**. Ainda são necessárias, com autorização:

- backup/restauração e dry-run no projeto Firebase real;
- APPLY controlado da migração da Banca Ana Maria;
- provisionamento real do Platform Owner, memberships e Tenant B de homologação;
- integração Cloudflare/Worker em staging;
- inspeção visual, mobile e screenshots reais.

Não declarar `READY_FOR_GLOBAL_STANDARD_IMPLEMENTATION` sem completar o readiness gate operacional. Entitlements continuam NEXT.
