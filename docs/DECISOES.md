# DECISÕES ARQUITETURAIS

Registre aqui mudanças relevantes tomadas durante o desenvolvimento, com data, motivo e impacto. Não apague decisões antigas; marque-as como substituídas quando necessário.

## 2026-09-28 — Reconciliação inicial entre diagramas e regras vigentes

- **Scaffold:** o ZIP disponível já corresponde integralmente ao conteúdo da raiz, verificado por hash. A implementação será construída sobre essa estrutura; não será feita uma extração que possa sobrescrever arquivos ou alterar `.git`.
- **Armazenamento/OCR:** não usar Firebase Storage na V1. Imagens e PDFs ficam no dispositivo, são processados localmente e descartados; OCR não será movido para Cloud Functions. A foto pública da banca, quando fornecida, será um arquivo estático em `public/banca/`.
- **Dados pessoais:** o modelo operacional de cliente não terá e-mail nem foto, apesar de campos presentes no ERD/modelo Firestore. Busca pública será por nome com resultados limitados e telefone mascarado; acesso a reservas exige vínculo de sessão/identidade validado.
- **Reserva e estoque:** adotar estados canônicos da regra de negócio com estados de reserva distintos dos estados de cada item. Cancelamento e expiração liberam quantidade na mesma operação atômica, preservando o histórico. Cada item de reserva manterá referência ao `itemReparteId` de origem (além do produto), pois o produto permanente não determina qual lote está sendo retirado.
- **Disponibilidade/recolhimento:** disponibilidade será derivada dos totais recebidos, reservados, retirados e devolvidos; a conferência física é explícita e nunca será inferida por job. Campos materializados, se usados, serão atualizados na mesma transação.
- **Perfil da banca:** tratar perfil e horários como configuração singular da banca na V1, em linha com o documento canônico de Firestore e com a operação de uma única banca; não implementar múltiplas contas/perfis de banca sem requisito.
- **Motivo:** estes pontos reconciliam Storage/OCR, privacidade, cancelamento, lote e perfil onde os diagramas divergem das regras explícitas e atuais em `AGENTS.md`/TXT de objetivo. Impacto: serviços, schemas, regras Firestore e telas devem refletir essas interpretações.

## 2026-09-28 — Preflight do repositório

- O repositório local começa sem commits, com todos os arquivos não rastreados. O remoto oficial está configurado, mas não anuncia branches. Preservar todos os arquivos e não reescrever histórico; verificar novamente o remoto antes de decidir como publicar o primeiro commit.
- A estrutura existente é scaffold sem dependências ou implementação, confirmada pela comparação com o ZIP. A execução poderá preencher módulos vazios, mantendo os caminhos definidos sempre que possível.

## 2026-09-29 — Segurança, recuperação de sessão e integração de fluxos

- **Sessão de cliente sem takeover:** não emitir uma nova sessão apenas com nome e telefone para um telefone já associado a perfil. Esses dados não provam posse do aparelho/linha; a tentativa retorna `profile_session_exists` e orienta contato com a banca. Sessões opacas locais duram 30 dias e renovam durante o uso quando faltam até sete dias. A recuperação de cliente sem acesso ao aparelho requer verificação humana pela banca, pois a UX não pode exigir OTP, e-mail ou senha.
- **Cursor assinado:** paginação de catálogo, reservas do cliente e administração usa HMAC com escopo/filtros vinculados ao token e verificação WebCrypto, evitando reutilização em outra busca/filtro.
- **Contratos de API:** respostas do Worker preservam os envelopes documentados para perfil, item do catálogo e reserva. Escritas idempotentes enviam `Idempotency-Key`; atualizações de intenção, remarcação e criação de reserva retornam a reserva completa esperada pela UI.
- **Retiradas do dia:** filtrar no Worker por limites do dia no fuso `America/Sao_Paulo` e estados de reserva ativos/parcialmente retirados. A UI pagina com cursor assinado; a confirmação baixa somente unidades registradas como fisicamente retiradas.
- **Perfil público da banca:** a página de localização lê perfil e horários pelo repositório de domínio; usa os dados locais predefinidos enquanto a configuração pública remota está indisponível.
- **Limites de catálogo:** limitar leitura por requisição e retornar cursor; recalcular estoque no Worker. Aplicar o rate limit já provisionado aos endpoints de lista e detalhe públicos.
- **Limites de PDF/OCR e PWA:** restringir tamanho/páginas/pixels e liberar recursos de PDF/OCR no `finally`. Pré-carregar apenas o shell leve; carregar chunks e arquivos de OCR por cache de runtime, para não baixar dezenas de megabytes durante a instalação.
- **Provisionamento inicial:** criar script Node sem credencial embutida, via Google Cloud Application Default Credentials, que cria apenas o documento de usuário admin e não sobrescreve documentos. ID oficial da banca e UID precisam vir do ambiente real e continuam pendentes.

## 2026-09-29 — Preparação de deploy Cloudflare

- Manter Worker e frontend no repositório oficial, com rota `/api/*` no mesmo domínio quando o domínio/zone forem definidos, ou `VITE_API_BASE_URL` explícita se hospedados em origens distintas.
- O frontend pode usar integração GitHub/Cloudflare Pages. O Worker precisa de bindings/segredos separados; `BANCA_ID`, domínio/CORS, namespace real de rate limit, `FIREBASE_SERVICE_ACCOUNT_JSON` e `CLIENT_SESSION_PEPPER` são valores de ambiente e não devem ser adicionados ao Git.
- O Vite encaminha `/api` para o Wrangler local em `localhost:8787`; isso mantém a UI e a API same-origin durante desenvolvimento. O typecheck do Worker tem configuração e comando próprios (`npm run worker:typecheck`) em vez de depender acidentalmente das opções do frontend.
- O Wrangler é uma dependência de desenvolvimento com versão fixa; os tipos de runtime e bindings são gerados de `wrangler.toml` para `worker-configuration.d.ts` e usados no typecheck. O exemplo declara os dois secrets obrigatórios sem incluir seus valores no repositório. O `namespace_id` de rate limit é um inteiro positivo escolhido de forma exclusiva para a conta Cloudflare.
- Nenhum deploy deve ocorrer antes de validação de build, lint, tipos, testes no Emulator/staging e teste do fluxo real com a conta provisionada.
