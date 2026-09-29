# CONTEXTO ATUAL

Projeto: sistema de reservas, catálogo e operação de consignação/recolhimento para a Banca Ana Maria, com foco absoluto em uso por celular.

Este arquivo é memória operacional do desenvolvimento. O agente deve atualizá-lo quando concluir módulos, descobrir limitações, alterar decisões ou estabelecer integrações que afetem trabalhos futuros.

## Estado em 2026-09-29 — implementação e auditoria

- O scaffold inicial descrito abaixo foi preenchido: aplicação React/Vite mobile-first, autenticação administrativa Firebase, Worker Cloudflare, camada de domínio/repositórios, catálogo e reservas públicas, operação administrativa de listas/retiradas/recolhimentos, importação local, geração de relatórios e PWA estão implementados no repositório.
- Repositório oficial e projeto Firebase seguem `CristianoRFB/sistema-de-banca` e `banca-88851`. A implementação está na branch `main`; a revisão de Wrangler abaixo foi aplicada após o commit integrado e também será registrada na branch.
- O browser acessa o Firestore apenas pelo Worker. As regras Firestore continuam `deny all`; o Worker usa credencial de serviço mantida como segredo Cloudflare. A V1 não usa Storage.
- A sessão do cliente é local e opaca, expira após 30 dias e renova em atividade antes de expirar. Para impedir takeover por quem conhece nome e telefone, criar sessão para um telefone já vinculado exige recuperação assistida pela banca. Não há OTP/e-mail exigido na UX.
- O catálogo público agora pagina resultados depois de aplicar busca por título/volume/editora, tipo e disponibilidade, calcula estoque em tempo real, valida cursores assinados e aplica rate limit. Cada requisição pode examinar até 200 itens de catálogo; resultados seguintes continuam pelo cursor.
- A fila “Retiradas de hoje” consulta a data de Santa Fé do Sul, somente reservas ativas/parcialmente retiradas, e pagina resultados. A página pública de localização busca endereço, telefone e horários configurados, usando valores de fallback enquanto a API não responde.
- O importador PDF/OCR aplica limites de tamanho, páginas e pixels e libera recursos locais mesmo em falha. O PWA pré-carrega o shell reduzido; os chunks JavaScript e os arquivos OCR usam cache de runtime.
- Foi adicionado `npm run provision:admin`, um script de criação única para `bancas/{BANCA_ID}/usuarios/{ADMIN_UID}` via Google Cloud ADC. Ele não lê nem grava chave de service account no repositório e não sobrescreve um documento existente.
- Wrangler `4.143.1` está instalado localmente com versão fixa para reduzir diferenças entre máquinas. Os tipos de runtime e bindings são gerados para `cloudflare/worker/worker-configuration.d.ts`; `npm run worker:typecheck` os usa, e `npm run worker:types` regenera o arquivo a partir da configuração privada local.
- **Validação em 2026-09-29:** `npm run build`, `npm run lint`, `npm test` (17 arquivos/56 testes), `npm run worker:typecheck`, `npm audit` (0 vulnerabilidades), `wrangler deploy --dry-run` e as regras Firestore (2 testes no Emulator `demo-banca`) passaram.
- O build ainda avisa sobre chunks individuais acima de 500 KiB (principalmente ExcelJS/PDF, carregados sob demanda); eles não entram no precache inicial do PWA.
- Deploy de staging/produção e QA visual em dispositivo real ainda não foram feitos. A superfície browser do Codex estava indisponível para inspeção visual nesta rodada. Os bloqueios de conta/domínio estão em `docs/PENDENCIAS.md`.

## Próximas ações

- Resolver os valores e permissões reais descritos em `docs/PENDENCIAS.md`; depois validar o fluxo ponta a ponta em staging.
- Fazer inspeção visual mobile/PWA em dispositivo real e repetir as validações automatizadas sempre que houver nova alteração.

## Snapshot inicial encontrado em 2026-09-28 (histórico; superado pela implementação acima)
- O ZIP `C:\Users\Aluno\Downloads\sistema-de-banca-scaffold.zip` já estava mesclado na raiz. Os 306 itens do ZIP foram comparados com o workspace por SHA-256; nenhum arquivo estava ausente ou diferente. Não foi necessário extrair nem sobrescrever arquivos.
- O repositório contém a estrutura prevista pelo manifesto, mas a aplicação ainda não tem implementação funcional: os arquivos de `src/`, os cinco arquivos TypeScript do Worker e os scripts de seed/validação estão vazios. Os testes contêm apenas placeholders.
- `package.json` define os scripts `build`, `lint` e `test`, mas ainda não declara dependências; não há lockfile nem `node_modules`.
- `firestore.rules` está em deny-all e `firestore.indexes.json` está vazio. Firebase Auth, repositórios, transações e Worker ainda não têm código.
- O manifesto PWA existe, mas não tem ícones; os arquivos `.placeholder` não são imagens válidas. Não há CSS nem service worker funcional.
- `.firebaserc` aponta para `banca-88851`; `.env.example` contém apenas configuração Web pública. Não há segredos privados identificados nos arquivos de configuração inspecionados.
- `origin` aponta para `https://github.com/CristianoRFB/sistema-de-banca.git`, mas o checkout local não possui commits (branch `main` sem histórico) e `git ls-remote --heads origin` não retornou branches. Todo o scaffold aparece como não rastreado. Nenhum arquivo foi removido ou sobrescrito nesta inspeção.
- Foram lidos `AGENTS.md`, todos os arquivos em `agents/` e `docs/estrutura-original/`, os três documentos de contexto, `FIREBASE_ARCHITECTURE.md`, `README.md` e os oito diagramas.
- A documentação confirma o scaffold inicial sem código, portanto o contexto anterior estava correto; o principal gap é implementar e integrar os módulos, não substituir código funcional.
- Divergências encontradas nos diagramas e interpretações adotadas estão registradas em `docs/DECISOES.md`.

## Registro de trabalho executado depois do snapshot inicial
- Fundação, regras de domínio, repositórios, telas operacionais, Worker e PWA foram preenchidos em implementação posterior.
- A auditoria atual está reconciliando contratos entre UI e Worker, privacidade, paginação, limites de entrada, custos de consulta e fluxos mobile.
- Deploy e publicação ainda não foram tentados; dependem das configurações e permissões externas pendentes.

## Infraestrutura alvo
- GitHub: CristianoRFB/sistema-de-banca
- Firebase project: banca-88851
- Cloudflare: frontend via integração com GitHub; tarefas agendadas podem usar Worker/Cron se realmente necessário.
- Sem Firebase Storage na V1.
