# PENDÊNCIAS / BLOQUEIOS

Quando uma frente exigir intervenção humana real, registre: módulo, bloqueio, por que não pode ser resolvido autonomamente, o que já foi tentado e qual dado/ação humana falta. Depois avance para outra frente.

## Bloqueios para ativar banca real e publicar — 2026-09-29

### Provisionamento da primeira conta administrativa

- **Bloqueio:** falta o ID confirmado do documento `bancas/{bancaId}` e o UID da conta Firebase Auth que será a primeira administradora.
- **Por que depende da banca:** o ID do documento e a identidade autorizada precisam vir do projeto/conta real; inferi-los poderia provisionar acesso no caminho errado.
- **Preparação concluída:** `npm run provision:admin` cria exclusivamente `bancas/{BANCA_ID}/usuarios/{ADMIN_UID}` como `ADMIN` (ou `OPERADOR` se `ADMIN_ROLE` for solicitado), usando `gcloud auth application-default print-access-token`. A operação é create-only e não sobrescreve um usuário existente.
- **Estado local verificado em 2026-09-29:** Google Cloud CLI/ADC não está disponível neste checkout; não foi emitido token nem tentada gravação no Firestore.
- **Ação necessária:** confirmar o ID da banca, criar/identificar a conta em Firebase Authentication, autorizar ADC do operador com permissão de escrita no Firestore e executar o script com `FIREBASE_PROJECT_ID=banca-88851`, `BANCA_ID`, `ADMIN_UID` e opcionalmente `ADMIN_ROLE=ADMIN`.
- **Estado:** bloqueado até os identificadores/conta serem fornecidos; nenhum dado fictício foi enviado ao Firebase.

### Domínio, Worker e segredos de produção

- **Bloqueio:** faltam domínio/origem final, zona Cloudflare e projeto Pages conectado ao repositório oficial.
- **Preparação concluída:** `cloudflare/worker/wrangler.toml.example` aponta ao projeto Firebase oficial e contém placeholders explícitos; `BANCA_ID`, `CORS_ORIGINS`, regra de rota e um `namespace_id` positivo e exclusivo para a conta precisam ser definidos no ambiente de deploy. O frontend usa `/api` por padrão, compatível com rota same-origin. Wrangler local está fixado no projeto, e `npm run worker:types` gera os tipos dos bindings com base na configuração privada.
- **Estado Cloudflare verificado em 2026-09-29:** Wrangler está autenticado para Workers/Pages. A listagem de projetos Pages mostrou somente `caravana-77`, sem provedor Git; ele não foi alterado. O Worker `sistema-de-banca-api` não existe. O arquivo local ignorado `cloudflare/worker/wrangler.toml`, `.dev.vars` e as variáveis `BANCA_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `CLIENT_SESSION_PEPPER`, `CORS_ORIGINS` e `VITE_API_BASE_URL` não estão disponíveis neste checkout.
- **Segredos necessários fora do Git:** `FIREBASE_SERVICE_ACCOUNT_JSON` (conta de serviço com privilégio mínimo) e `CLIENT_SESSION_PEPPER` (aleatório, com pelo menos 32 bytes). Não guardar cópias em `.dev.vars` versionado, log, issue ou documentação.
- **Ação necessária:** configurar um domínio/zona apropriado, escolher um `namespace_id` livre na conta Cloudflare, criar os dois Worker Secrets pelo painel/CLI e conectar o repositório oficial ao Pages. Se a API ficar em outra origem, configurar `VITE_API_BASE_URL` e incluir somente a origem exata em `CORS_ORIGINS`.
- **Tentativa após pedido explícito de publicação:** a consulta ao Worker confirmou que ele ainda não existe. O dry-run com cópia temporária do exemplo foi aprovado, mas não faz upload. Não executei deploy real: os valores atuais do exemplo são placeholders e faltam os segredos exigidos; implantá-los poderia publicar uma API inutilizável.
- **Frontend:** não enviei somente `dist/` para um novo Pages Direct Upload. O app chama `/api`, portanto sem Worker o site não completa os fluxos; além disso, a Cloudflare informa que um projeto criado por Direct Upload não pode depois ser convertido para integração Git. Não usei o projeto `caravana-77`, que pertence a outro app. O fluxo desejado continua sendo conectar `CristianoRFB/sistema-de-banca` ao Pages por Git e configurar o Worker com origem/CORS compatíveis.
- **Ação necessária para publicação funcional:** conectar o repositório oficial ao Pages (ou autorizar a integração Git da Cloudflare), confirmar o ID real de `bancas/{bancaId}`, provisionar a conta de serviço Firebase e o segredo aleatório `CLIENT_SESSION_PEPPER`, definir a origem/CORS de produção e escolher um namespace de rate limit livre. Se não houver domínio/zona, é possível configurar origem separada em `*.pages.dev` e `*.workers.dev`, com `VITE_API_BASE_URL` e `CORS_ORIGINS` coerentes.
- **Estado:** código no GitHub; nenhum deploy real, Worker, projeto Pages novo, domínio ou segredo foi criado.

### Recuperação de sessão do cliente sem aparelho anterior

- **Bloqueio:** ao vincular um telefone a perfil e sessão, nome + telefone sozinhos não podem emitir uma segunda sessão sem reabrir a possibilidade de takeover. Após expirar uma sessão sem uso por 30 dias, encerrar a sessão ou perder o aparelho, o cliente pode precisar de ajuda da banca.
- **Motivo:** o requisito de UX exclui OTP obrigatório, e-mail e senha; o backend não consegue provar posse do telefone apenas com esses campos.
- **Ação necessária:** o atendimento deve verificar a identidade fora do app antes de restabelecer acesso. Uma recuperação automatizada só pode ser adicionada depois que houver um canal de prova de posse aprovado; não adicionar OTP silenciosamente contra o requisito vigente.

## Disponibilidade offline — política implementada

- O PWA mantém o shell e os chunks comuns disponíveis após instalação. Arquivos grandes de OCR/PDF/XLSX permanecem sob demanda e não aumentam o download inicial.
- Somente GETs do perfil público da banca e do catálogo usam cache NetworkFirst com até 15 minutos de idade. Se o aparelho estiver offline, a interface informa que os dados podem estar desatualizados.
- Busca de perfil do cliente, dados privados de cliente/admin e erros continuam sem cache. Reservar, cancelar, reagendar, retirar, editar e reconciliar exigem conexão e resposta atual do Worker.
- A política e seus limites estão registrados em `docs/DECISOES.md`. Continuar validando esse comportamento em dispositivo instalado quando houver URL de staging e aparelho disponível.

## Validações antes de deploy

- **Concluído em 2026-09-29:** `npm run build`, `npm run lint`, `npm test` (24 arquivos/81 testes), `npm run worker:typecheck`, `npm audit` (0 vulnerabilidades), dry-run do Wrangler `4.143.1` usando cópia temporária de `wrangler.toml.example` e 2 verificações de regras no Emulator `demo-banca`. O dry-run empacota, não publica.
- O `firebase.json` mantém a porta local `8086`; durante a auditoria ela não aceitou bind. A validação bem-sucedida das regras usou uma configuração temporária na porta `18086`, removida ao final. Uma aplicação Java já ocupava `8080` e outro serviço local ocupava `8085`; nenhum processo local foi encerrado. Os testes usam ID `demo-banca` para impedir conexão acidental com produção.
- Com configuração real em staging, validar login admin/provisionamento, leitura e paginação do catálogo, perfil e sessão do cliente, criação/cancelamento/retirada transacionais, atualização de horários, filas de recolhimento e instalação/atualização PWA em dispositivo móvel.
- QA visual real depende de URL de staging e aparelho/navegador disponível. A superfície de browser do Codex estava indisponível durante esta rodada; não houve inspeção visual em dispositivo ou produção.
