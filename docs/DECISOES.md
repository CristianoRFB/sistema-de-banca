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
