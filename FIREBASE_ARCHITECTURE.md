# Firebase architecture

A especificação canônica está em `docs/estrutura-original/ESTRUTURA_FIREBASE.txt`. Leia-a antes de implementar Firestore/Auth/rules.

Baseline: deny-by-default; sem Firebase Storage na V1; admin autenticado; cliente com UX simples mas escrita tecnicamente protegida; operações críticas transacionais; histórico preservado; consultas econômicas.
