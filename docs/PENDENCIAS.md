# PENDÊNCIAS / BLOQUEIOS

Quando uma frente exigir intervenção humana real, registre: módulo, bloqueio, por que não pode ser resolvido autonomamente, o que já foi tentado e qual dado/ação humana falta. Depois avance para outra frente.

## Bloqueios para ativar banca real e publicar — 2026-09-29

### Provisionamento da primeira conta administrativa

- **Bloqueio:** falta o ID confirmado do documento `bancas/{bancaId}` e o UID da conta Firebase Auth que será a primeira administradora.
- **Por que depende da banca:** o ID do documento e a identidade autorizada precisam vir do projeto/conta real; inferi-los poderia provisionar acesso no caminho errado.
- **Preparação concluída:** `npm run provision:admin` cria exclusivamente `bancas/{BANCA_ID}/usuarios/{ADMIN_UID}` como `ADMIN` (ou `OPERADOR` se `ADMIN_ROLE` for solicitado), usando `gcloud auth application-default print-access-token`. A operação é create-only e não sobrescreve um usuário existente.
- **Ação necessária:** confirmar o ID da banca, criar/identificar a conta em Firebase Authentication, autorizar ADC do operador com permissão de escrita no Firestore e executar o script com `FIREBASE_PROJECT_ID=banca-88851`, `BANCA_ID`, `ADMIN_UID` e opcionalmente `ADMIN_ROLE=ADMIN`.
- **Estado:** bloqueado até os identificadores/conta serem fornecidos; nenhum dado fictício foi enviado ao Firebase.

### Domínio, Worker e segredos de produção

- **Bloqueio:** faltam domínio/origem final, zona Cloudflare e namespace ID de rate limit provisionado; a autenticação Cloudflare para publicar Worker/PWA também não está disponível neste checkout.
- **Preparação concluída:** `cloudflare/worker/wrangler.toml.example` aponta ao projeto Firebase oficial e contém placeholders explícitos; `BANCA_ID`, `CORS_ORIGINS`, regra de rota e namespace precisam ser substituídos no ambiente de deploy. O frontend usa `/api` por padrão, compatível com rota same-origin.
- **Segredos necessários fora do Git:** `FIREBASE_SERVICE_ACCOUNT_JSON` (conta de serviço com privilégio mínimo) e `CLIENT_SESSION_PEPPER` (aleatório, com pelo menos 32 bytes). Não guardar cópias em `.dev.vars` versionado, log, issue ou documentação.
- **Ação necessária:** informar/configurar domínio e zona, provisionar a regra de rate limit Cloudflare, criar os dois Worker Secrets pelo painel/CLI e conectar o repositório oficial ao Pages. Se a API ficar em outra origem, configurar `VITE_API_BASE_URL` e incluir somente a origem exata em `CORS_ORIGINS`.
- **Estado:** deploy não tentado; nenhum recurso, segredo ou serviço externo foi criado nesta rodada.

### Recuperação de sessão do cliente sem aparelho anterior

- **Bloqueio:** ao vincular um telefone a perfil e sessão, nome + telefone sozinhos não podem emitir uma segunda sessão sem reabrir a possibilidade de takeover. Após expirar uma sessão sem uso por 30 dias, ou perder o aparelho, o cliente pode precisar de ajuda da banca.
- **Motivo:** o requisito de UX exclui OTP obrigatório, e-mail e senha; o backend não consegue provar posse do telefone apenas com esses campos.
- **Ação necessária:** o atendimento deve verificar a identidade fora do app antes de restabelecer acesso. Uma recuperação automatizada só pode ser adicionada depois que houver um canal de prova de posse aprovado; não adicionar OTP silenciosamente contra o requisito vigente.

## Validações antes de deploy

- **Concluído em 2026-09-29:** `npm run build`, `npm run lint`, `npm test` (17 arquivos/56 testes), `npm run worker:typecheck` e as 2 verificações de regras no Emulator `demo-banca`.
- O Emulator usa a porta local `8086`, configurada em `firebase.json`; uma aplicação Java já estava ocupando a porta padrão `8080` e outro serviço local ocupou `8085`. Os testes usam ID `demo-banca` para impedir conexão acidental com produção.
- Com configuração real em staging, validar login admin/provisionamento, leitura e paginação do catálogo, perfil e sessão do cliente, criação/cancelamento/retirada transacionais, atualização de horários, filas de recolhimento e instalação/atualização PWA em dispositivo móvel.
- QA visual real depende de URL de staging e aparelho/navegador disponível. A superfície de browser do Codex estava indisponível durante esta rodada; não houve inspeção visual em dispositivo ou produção.
