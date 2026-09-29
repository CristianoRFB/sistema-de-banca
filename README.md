# Sistema de Banca — Ana Maria

Aplicação mobile-first/PWA para catálogo público, reservas de clientes e operação de uma banca de consignação. O repositório oficial é `CristianoRFB/sistema-de-banca`; o Firebase oficial é `banca-88851`.

## Estrutura

- `src/`: React, telas, features, repositórios, domínio e infraestrutura web.
- `cloudflare/worker/`: API Cloudflare, transações Firestore, autenticação e tarefas agendadas.
- `scripts/`: validação local e provisionamento create-only do primeiro usuário administrativo.
- `docs/`: contexto, decisões, pendências, regras e diagramas canônicos.
- `public/tesseract/` e `public/tessdata/`: runtime OCR local; imagens/documentos do cliente não são enviados nem armazenados.

O browser não acessa Firestore diretamente. As regras estão em deny-all e a API Worker aplica autenticação, escopo de banca, limites de entrada, rate limit e transações. A V1 não usa Firebase Storage.

## Desenvolvimento

1. Use Node.js 24 ou uma versão LTS compatível e execute `npm ci`.
2. Copie `.env.example` para `.env.local`. A configuração Web Firebase já versionada é pública; não coloque credenciais privadas no frontend.
3. Copie `cloudflare/worker/wrangler.toml.example` para `cloudflare/worker/wrangler.toml` e preencha o ID real da banca, origens e um `namespace_id` numérico positivo ainda não usado na conta Cloudflare. O arquivo privado e `.dev.vars` são ignorados pelo Git.
4. Crie `cloudflare/worker/.dev.vars` localmente com `FIREBASE_SERVICE_ACCOUNT_JSON` e `CLIENT_SESSION_PEPPER`. Não compartilhe nem versione esse arquivo.
5. Em um terminal, execute `npm run worker:dev` (API em `localhost:8787`). Em outro, execute `npm run dev`; o Vite encaminha `/api` ao Worker local. O projeto instala uma versão local e fixa do Wrangler para desenvolvimento e validação.

Para testar apenas a interface sem Worker, `npm run dev` inicia o frontend, mas as ações que chamam a API dependem do passo 5.

## Validação local

```sh
npm run build
npm run lint
npm test
npm run worker:typecheck
```

Depois de copiar e configurar o `wrangler.toml` local, regenere os tipos de bindings com `npm run worker:types` quando alterar vars, secrets, bindings ou a data de compatibilidade. O arquivo gerado `cloudflare/worker/worker-configuration.d.ts` é versionado para que o typecheck do Worker também funcione em checkouts sem configuração privada.

Os testes das regras Firestore ficam em `tests/firestore/firestore.rules.test.ts` e devem rodar exclusivamente com o Firebase Emulator, nunca contra produção:

```sh
npx --yes firebase-tools emulators:exec --project demo-banca --only firestore "npx vitest run --config vitest.firestore.config.ts"
```

## Primeiro administrador

Crie/identifique a conta em Firebase Authentication e obtenha o UID. Configure Google Cloud ADC no operador autorizado e execute `npm run provision:admin` com `FIREBASE_PROJECT_ID=banca-88851`, o `BANCA_ID` confirmado e `ADMIN_UID`. O script cria apenas `bancas/{BANCA_ID}/usuarios/{ADMIN_UID}` e recusa sobrescrever um registro existente. Veja `docs/PENDENCIAS.md` antes de ativar uma banca real.

## Deploy

O frontend está preparado para Cloudflare Pages conectado ao GitHub. O Worker precisa de uma rota `/api/*` no domínio configurado ou de uma origem API própria, mais os segredos `FIREBASE_SERVICE_ACCOUNT_JSON` e `CLIENT_SESSION_PEPPER` cadastrados fora do Git. Configure também o ID oficial da banca, CORS exato, namespace de rate limit e índices Firestore.

O deploy real permanece pendente da configuração do domínio, da conta Cloudflare e do provisionamento administrativo. Faça `wrangler deploy --dry-run` localmente para verificar o bundle antes de qualquer publicação. Não envie dados fictícios ao Firebase. Consulte `docs/CONTEXTO_ATUAL.md`, `docs/DECISOES.md` e `docs/PENDENCIAS.md`.
