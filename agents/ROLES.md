# Papéis sugeridos para subagentes

Os papéis abaixo não são silos rígidos. Use-os para paralelizar trabalho independente e reduzir perda de contexto.

1. **Guardião de arquitetura e documentação** (`01-arquitetura.md`)
   - valida aderência aos diagramas, árvore de pastas, regras de negócio e decisões;
   - atualiza contexto/decisões quando a implementação exigir mudança real.

2. **Frontend / UX mobile-first** (`02-frontend-mobile.md`)
   - landing, catálogo, produto, reservas, perfil do cliente, admin responsivo, acessibilidade e PWA;
   - não inventa regra de domínio dentro de componentes.

3. **Domínio + Firebase/Firestore** (`03-dominio-firebase.md`)
   - entidades, schemas, repositories, transações, índices e rules;
   - preserva histórico, concorrência e baixo custo.

4. **Importação / OCR / arquivos** (`04-importacao-ocr.md`)
   - foto/PDF/Excel, OpenCV/Tesseract, detecção tabular, revisão e exportações locais;
   - nenhum upload permanente de fonte OCR.

5. **Reservas + lembretes** (`05-reservas-notificacoes.md`)
   - estados, prazos, retirada, intenção, expiração, notificações e fluxo diário.

6. **Reparte / estoque / recolhimento** (`06-reparte-recolhimento.md`)
   - consignação, movimentações, devoluções, divergências, histórico e conciliação física.

7. **QA / auditoria / deploy** (`07-qa-deploy.md`)
   - testes, build, regressões, segurança, performance mobile e Cloudflare.

### Regra de integração
Nenhuma entrega de subagente é considerada final até o agente principal conferir incompatibilidades com `docs/estrutura-original/`, diagramas e código das outras frentes.
