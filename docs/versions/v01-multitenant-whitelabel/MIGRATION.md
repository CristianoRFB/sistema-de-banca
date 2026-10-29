# MIGRATION — Banca Ana Maria / Tenant A

## Escopo e status

A migração preserva a Banca Ana Maria como Tenant A. O script `npm run migrate:multitenant` é **dry-run por padrão** e não executou migração real neste repositório. O código e os testes são preparação, não evidência de execução em produção.

## Variáveis

- `FIREBASE_PROJECT_ID`: projeto Firebase já existente, conferido com o responsável;
- `BANCA_ID`: ID real do documento `bancas/{id}` da Ana Maria;
- `TENANT_SLUG`: slug canônico aprovado para o Tenant A;
- `CLIENT_SESSION_PEPPER`: **o mesmo secret HMAC** da aplicação, nunca publicado no Git;
- `APPLY=1`: habilita escrita após pré-validação;
- `CONFIRM_PROJECT_ID` e `CONFIRM_BANK_ID`: exigidos **somente com APPLY=1**, devendo corresponder exatamente aos alvos.

Nunca registrar a chave HMAC, ADC, tokens ou números de telefone em arquivos, mensagens ou capturas.

## Fluxo sem escrita (obrigatório)

1. Validar projeto, banca, slug e secret no ambiente seguro;
2. Autenticar a identidade autorizada via Google ADC;
3. Executar `npm run migrate:multitenant` com `APPLY` ausente;
4. O dry-run lê a banca original, todos os clientes pertinentes, duplicidade de slug e índices de telefone v2;
5. A pré-validação rejeita slug já utilizado por outro tenant, slug reservado, mudança de slug preexistente sem revisão, colisão, IDs duplicados de clientes, telefone duplicado entre clientes, divergências entre os campos bruto/normalizado e ausência de `updateTime` confiável para atualizar o tenant;
6. Revisar **contagens agregadas**, registro de backup/recuperação e autorização de produção.

A pré-validação **não altera documentos**. A saída não contém telefones, identificadores individuais de clientes, hashes ou segredos.

## Aplicação controlada

Somente após validar projeto, backup, contagens e autorização, configurar:

```sh
APPLY=1 CONFIRM_PROJECT_ID="$FIREBASE_PROJECT_ID" CONFIRM_BANK_ID="$BANCA_ID" npm run migrate:multitenant
```

O comando acima é um exemplo para shell Unix; adapte as variáveis ao terminal usado. O script:

- cria **somente índices ausentes** com create exclusivo (não sobrescreve índice alheio);
- mantém documentos dos clientes, catálogos, listas, histórico e dados originais;
- não altera o status `ativo` já existente da banca;
- após criar os índices, **relê todos os índices esperados no Firestore**, rejeitando índices ausentes, alterados ou pertencentes a outro tenant; em seguida, **relê a lista de clientes** para verificar IDs e telefones canônicos inalterados e **consulta novamente a unicidade do slug**; havendo alteração concorrente, a etapa de finalização é recusada e deve-se refazer o dry-run;
- depois dessa revalidação, atualiza somente `slug` e `atualizadoEm` com precondition `currentDocument.updateTime`, impedindo escrita silenciosa se a banca foi modificada em paralelo.

## Falha parcial, recuperação e limites

**Não existe rollback destrutivo automático.** Essas revalidações reduzem riscos de corrida, mas não substituem janela de manutenção, backup verificado ou verificação final de produção: mudanças podem ocorrer após a última leitura e antes da escrita final. Se uma escrita de índice falhar depois de outras concluírem, as criações anteriores são mantidas. O comando informa quantas criações ocorreram e orienta:

1. interromper novas operações de migração;
2. revisar a falha e preservar backup;
3. repetir o dry-run para detectar índices `ALREADY_PRESENT`;
4. repetir APPLY somente após corrigir as condições, sem deletar índices já criados.

Se o PATCH final falhar por precondition, o slug permanece inalterado; os índices que já existem permanecem válidos. O próximo dry-run identifica o que falta.

O script **não** provisiona `platform_owner`, não cria Tenant B de produção, não cria outras contas e não ativa billing.

## Testes automatizados

`tests/unit/multitenant-migration.test.mjs` usa gateway em memória (sem Google ADC e sem Firebase real) e cobre:

- dry-run sem escrita;
- APPLY idempotente e preservação do estado ativo/inativo;
- slug duplicado e índice conflitante;
- telefone duplicado e campos de telefone inconsistentes;
- falha parcial/resume;
- falha no PATCH sem exclusão de dados;
- validação de configuração;
- hash tenant-scoped;
- validação de `updateTime` e IDs duplicados antes de escritas;
- alterações simultâneas de clientes e de slug durante APPLY antes da finalização.
- leitura de verificação depois de criar índices e falha segura se um índice sumir ou mudar de titular.

Comandos: `npm test`, `npm run lint`, `npm run build` e CI.

## Ordem operacional antes do release

1. Backup verificado + plano de restauração operado por pessoa autorizada;
2. Dry-run no projeto e banca corretos;
3. Conferência de contagens e colisões;
4. APPLY confirmado;
5. Validar dados e funcionalidades da Ana Maria no Tenant A;
6. Verificar Auth/memberships do responsável e índice de telefone;
7. Ensaiar Tenant B em **emulator/staging**, não automaticamente em produção;
8. Remover o fallback single-tenant somente em etapa compatível e aprovada.

**Produção permanece NÃO VERIFICADA até execução autorizada e evidência real.**
