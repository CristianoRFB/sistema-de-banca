# AGENTS.md — Sistema de Banca

Este repositório é um projeto novo e o agente tem ampla autonomia para implementar, refatorar, testar, auditar e organizar o sistema. A autonomia NÃO autoriza ignorar a documentação estrutural.

## Leitura obrigatória antes de alterar código
1. Leia integralmente `docs/estrutura-original/`.
2. Analise TODOS os diagramas em `docs/diagramas/`.
3. Leia `docs/CONTEXTO_ATUAL.md`, `docs/DECISOES.md` e `docs/PENDENCIAS.md`.
4. Inspecione o repositório e compare o estado real com a documentação.
5. Preserve implementações corretas. Não reescreva por gosto pessoal.

## Regra de execução contínua
- Objetivo: avançar o máximo possível rumo a um sistema completo e integrado.
- Não pare o projeto inteiro porque um módulo ficou bloqueado.
- Se uma tarefa exigir intervenção humana real (login externo, dado ausente, decisão impossível de inferir, permissão de conta etc.), registre em `docs/PENDENCIAS.md`, marque claramente o bloqueio e avance para outra frente independente.
- Termine cada frente até o maior nível possível antes de abandoná-la.
- Quando todas as frentes desenvolvíveis estiverem avançadas, faça auditoria geral: arquitetura, regras de negócio, segurança, Firestore, UX mobile, build, lint, tipos, testes, acessibilidade e deploy.
- Corrija o que a auditoria encontrar e só depois retorne às pendências antes consideradas bloqueadas.
- Não declare algo pronto sem verificar o fluxo real correspondente.

## Criação de arquivos
- Prefira os arquivos e diretórios já definidos no scaffold.
- Pode criar, dividir, mover ou renomear arquivos sem pedir permissão quando houver necessidade arquitetural real.
- Antes de criar uma nova abstração, verifique se já existe um local adequado.
- Registre mudanças estruturais relevantes em `docs/DECISOES.md` e atualize `docs/CONTEXTO_ATUAL.md`.
- Não crie arquivos duplicados só para contornar código existente.

## Restrições arquiteturais
- Mobile-first/PWA. Desktop é adaptação responsiva da mesma aplicação.
- UI -> feature/service -> regra de domínio -> repository -> infraestrutura. Evite Firebase diretamente em componentes React.
- Não usar Firebase Storage na V1.
- Imagens usadas por OCR devem ser processadas localmente e descartadas.
- JPG/PDF/XLSX de divulgação são gerados localmente, não armazenados permanentemente.
- Foto pública da banca é arquivo estático controlado pelo desenvolvedor em `public/banca/`.
- Firestore deve permanecer econômico e compatível com o plano gratuito durante o uso esperado.
- Dados históricos não são apagados por rotina; usam estados/arquivamento.
- Operações concorrentes de reserva/retirada/recolhimento devem usar transação ou mecanismo equivalente que preserve invariantes.
- Nunca guardar segredos, service accounts, chaves privadas ou tokens reais no Git.
- A configuração Web do Firebase fornecida no projeto é pública; credenciais privadas continuam proibidas no repositório.

## Identidade e privacidade do cliente
- UX do cliente: nome + telefone; sem e-mail, senha, foto ou OTP obrigatório.
- A busca pública de perfil é por nome, nunca por enumeração de telefones.
- Resultados exibem telefone mascarado.
- Não exponha listas globais de clientes nem telefones completos publicamente.
- Pode usar mecanismo técnico invisível (sessão local/identidade anônima segura) desde que a UX continue simples e as regras de segurança não permitam escrita arbitrária no Firestore.

## Deploy
- Repositório oficial: `CristianoRFB/sistema-de-banca`.
- Firebase oficial: `banca-88851`.
- Frontend deve ser preparado para deploy no Cloudflare a partir do GitHub.
- Antes de deploy: build, typecheck/lint e testes aplicáveis devem passar.
- Não criar outro Firebase nem outro repositório como substituto sem necessidade explícita.

## Subagentes
As funções sugeridas estão em `agents/`. O agente principal deve delegar frentes independentes quando isso acelerar o trabalho, mas deve integrar e auditar as entregas antes de considerá-las concluídas.
