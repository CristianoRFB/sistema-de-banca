# CONTEXTO ATUAL

Projeto: sistema de reservas, catálogo e operação de consignação/recolhimento para a Banca Ana Maria, com foco absoluto em uso por celular.

Este arquivo é memória operacional do desenvolvimento. O agente deve atualizá-lo quando concluir módulos, descobrir limitações, alterar decisões ou estabelecer integrações que afetem trabalhos futuros.

## Estado encontrado em 2026-09-28
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

## Próximo estado de trabalho
- Implementar fundação executável (dependências, rotas, estilos, PWA e inicialização segura).
- Integrar regras de domínio e repositórios antes das telas operacionais.
- Manter Firestore sem acesso público arbitrário; operações privadas de cliente dependem de identidade/sessão segura.
- Testar build, lint, domínio, regras e fluxos críticos conforme as frentes forem implementadas.
- Deploy e publicação ainda não foram tentados; dependem de configuração e permissões verificadas na fase de integração.

## Infraestrutura alvo
- GitHub: CristianoRFB/sistema-de-banca
- Firebase project: banca-88851
- Cloudflare: frontend via integração com GitHub; tarefas agendadas podem usar Worker/Cron se realmente necessário.
- Sem Firebase Storage na V1.
