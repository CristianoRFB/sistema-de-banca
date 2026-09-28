# Cloudflare

O frontend Vite pode ser publicado no Cloudflare Pages a partir do GitHub (`npm run build`, saída `dist`). A API e os jobs ficam em `worker/`; ela usa Firestore REST no projeto oficial `banca-88851`. O navegador acessa dados apenas pela API. `firestore.rules` nega acesso direto do SDK cliente.

## Configuração do Worker

Copie `worker/wrangler.toml.example` para `worker/wrangler.toml` e ajuste `BANCA_ID`, `CORS_ORIGINS` e o `namespace_id` do rate limiter. `BANCA_ID` é o ID do documento `bancas/{id}` no Firestore; `CORS_ORIGINS` contém origens exatas, separadas por vírgula, sem curingas. O `namespace_id` deve ser um inteiro positivo exclusivo para este rate limiter na conta Cloudflare.

Configure como Cloudflare Worker Secrets, nunca em `[vars]`, `.env`, frontend ou Git:

- `FIREBASE_SERVICE_ACCOUNT_JSON`: conteúdo JSON da service account criada para `banca-88851`. Dê a ela somente a permissão IAM de leitura/escrita necessária no Firestore (por exemplo, `roles/datastore.user`). A API valida associação da banca para cada operação; credenciais de servidor contornam Firestore Security Rules.
- `CLIENT_SESSION_PEPPER`: segredo aleatório de pelo menos 32 caracteres para HMAC de sessões, índices de telefone e cursors. Guarde uma cópia segura: trocar o segredo invalida sessões de clientes e cursors existentes.

Cadastre-os no ambiente Worker pelo prompt protegido do Wrangler (`wrangler secret put NOME_DA_SECRET`), executado dentro de `cloudflare/worker`. Nunca passe o valor como argumento de shell. `.dev.vars` já está ignorado pelo Git para desenvolvimento local; não use credenciais de produção em desenvolvimento.

Variáveis não secretas declaradas no exemplo:

- `FIREBASE_PROJECT_ID=banca-88851`
- `BANCA_ID=<id do documento bancas/{id}>`
- `CORS_ORIGINS=<origens HTTPS exatas do frontend>`
- Binding `CLIENT_RATE_LIMITER`: 60 chamadas por minuto por IP e escopo, fail-closed quando não configurado.

O cron a cada 15 minutos expira reservas, emite lembretes e promove repartes vencidos para `AGUARDANDO_RECOLHIMENTO`. Ele nunca confirma contagem ou devolução automaticamente. O endpoint `/api/health` não inclui identificadores nem dados do banco.

## Contrato HTTP

Todas as respostas de sucesso usam `{ "data": ... }`; erros usam `{ "error": { "code": "...", "message": "..." } }`. Coleções não são endpoints de leitura direta do Firestore. Admin envia Firebase ID token em `Authorization: Bearer ...`; o Worker valida assinatura, projeto e membro ativo em `bancas/{BANCA_ID}/usuarios/{uid}`. Escritas críticas exigem `Idempotency-Key` de 8 a 128 caracteres. Cliente usa token opaco em `Authorization: Bearer ...`.

### Público

- `GET /api/public/banca` → `data:{profile:{name,slug,phone,address,photoUrl},hours:[{dayOfWeek,closed,opensAt,closesAt}]}`. `dayOfWeek` é 0–6 (domingo–sábado); horários seguem `HH:mm`. Dias sem configuração usam seg–sex 08:00–18:00, sábado 08:00–13:00 e domingo fechado.
- `GET /api/public/catalog?q=&type=&availability=&sort=&limit=&cursor=` → `data:{items:[{id,listId,itemReparteId,productId,title,volume,type,publisher,price,available,publishedAt,reservationCutoffAt,plannedCollectionAt,status}],page:{limit,nextCursor,hasMore},filters}`. `type` aceita `MANGA|REVISTA|BOX|COLECIONAVEL|OUTRO`; `availability` aceita `all|available|low` (`low` são 1–3 unidades); `sort` aceita `recent|title`; limite máximo 50.
- `GET /api/public/catalog/:itemReparteId` → `data:{item}` com os mesmos dados públicos do produto.
- `GET /api/public/profile?name=` exige nome normalizado de pelo menos 3 caracteres e retorna no máximo 10 correspondências em `data:{profiles:[{id,name,maskedPhone}],hasMore}`. Não há endpoint de diretório global nem busca pública por telefone.

### Cliente

- `POST /api/client/sessions` `{name,phone}` cria ou localiza a identidade e retorna somente `data:{sessionToken,expiresAt,profile:{id,name,maskedPhone}}`. O token em texto puro só sai nesta resposta; Firestore armazena o HMAC.
- `GET /api/client/profile` → `data:{profile:{clientId,name,phone,maskedPhone}}`; `PATCH /api/client/profile` recebe `{name,phone}`.
- `GET /api/client/reservations` → `data:{reservations:[{id,status,createdAt,desiredDate,desiredTime,expiresAt,pickupIntent,items:[{id,itemReparteId,productId,title,volume,quantity,quantityWithdrawn,price,status}]}],page:{limit,nextCursor}}`.
- `POST /api/client/reservations` recebe `{items:[{itemReparteId,quantity}],desiredDate:'YYYY-MM-DD',desiredTime?:'HH:mm'}`; valida publicação, estoque, horário, limite de 9 dias e corte do lote na mesma transação que reserva o estoque.
- `POST /api/client/reservations/:id/cancel`, `PATCH /api/client/reservations/:id/intent` `{intent}` e `PATCH /api/client/reservations/:id/reschedule` `{desiredDate,desiredTime?}`. Cancelamento/reagendamento preservam vínculo de sessão; reagendamento valida novamente janela, horários e cortes, reinicia intenção/lembretes e registra histórico.
- `GET /api/client/notifications` → `data:{notifications:[{id,titulo,mensagem,criadaEm,lida,tipo}],page:{limit,nextCursor}}`.

### Admin

- `GET /api/admin/dashboard` → `data:{reservationsToday,activeReservations,draftLists,publishedLists,recollectionsDueSoon,reservations:[{id,customerName,desiredDate,desiredTime,pickupIntent,status}],upcomingRepartes:[{id,title,plannedCollectionAt,status}]}`.
- `GET /api/admin/reservations?status=&limit=&cursor=` → `data:{reservations:[...] ,page}`. Cada reserva inclui cliente com telefone mascarado e itens com `id,itemReparteId,productId,title,volume,quantity,quantityWithdrawn,status`.
- `POST /api/admin/reservations/:id/withdraw` recebe `{items:[{itemReservationId,quantity}]}`. Atualiza estoque, item/reserva, movimentação e histórico de venda atomicamente.
- `GET /api/admin/lists?status=&limit=&cursor=` → `data:{lists:[{id,title,totalItems,createdAt,publishedAt,status,version}],page}`.
- `POST /api/admin/lists` cria rascunho; `GET /api/admin/lists/:id` retorna `data:{list:{id,title,reparteId,status,createdAt,publishedAt,version},items:[{id,itemReparteId,productId,title,volume,price,quantity,publisher,originalTitle,returnDate,code,type,active,confidence,issues,requiresReview}]}`; `PUT /api/admin/lists/:id` salva as linhas revisadas; `POST /api/admin/lists/:id/publish` publica. Salvamento retorna `{listId,reparteId,status,itemCount,version}`. `quantity` e `price` podem ser `null` em rascunho; publicação exige os dois e recusa qualquer linha com `requiresReview:true`.
- `GET /api/admin/repartes?status=&limit=` → `data:{repartes:[{id,title,status,receivedAt,plannedCollectionAt,reservationCutoffAt}],page}`.
- `GET /api/admin/repartes/:id/reconciliation` → `data:{reparte,collection,items:[{itemReparteId,productId,title,volume,quantityExpected,quantityFound,quantityReturned,resolution,reserved,status}]}`. `POST /api/admin/repartes/:id/reconcile` exige `items` completos com `quantityFound` inteiro explicitamente preenchido em cada linha; divergências exigem resolução e justificativa.
- `GET /api/admin/banca` → `data:{profile:{id,name,phone,address,collectionSafetyMarginDays,withdrawalToleranceDays},hours:[{dayOfWeek,closed,opensAt,closesAt}]}`. `PUT /api/admin/banca` recebe `{profile:{name,phone,address,collectionSafetyMarginDays,withdrawalToleranceDays},hours:[...]}` e retorna `data:{profile,hours}`. O PUT exige papel `ADMIN`.
- `GET /api/admin/histories?type=sales|returns|changes&limit=` → `data:{entries,page:{limit,nextCursor}}`.

Operadores e admins passam pelas mesmas verificações de banca; mudança de configuração da banca exige papel `ADMIN`. A listagem admin não retorna telefones completos. Regras Firestore permanecem deny-all para usuários e clientes do Firebase SDK; somente o Worker usa credencial IAM de servidor.
