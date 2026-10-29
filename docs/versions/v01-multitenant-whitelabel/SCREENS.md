# SCREENS

## Regra
Screenshot real é evidência de uma tela executada. Mockup/imagem gerada não é screenshot.

## Evidência de navegador (UI executada com API fictícia)

O job `Browser smoke — desktop/mobile (synthetic API)` executa o **React/Vite real no Chromium** e captura as telas da interface com respostas de API simuladas para `banca-a` e `banca-b`. É um **screenshot real do frontend executado**, porém com **dados sintéticos e backend simulado**. NÃO é screenshot do Worker em staging, NÃO é prova de produção e NÃO deve ser apresentado como tela de cliente real.

As imagens ficam **somente no artefato do GitHub Actions** denominado `banca-browser-ui-fixtures` (retenção 14 dias); não existem neste repositório enquanto não forem baixadas e revisadas. O job produz, quando aprovado: `banca-a-desktop.png`, `banca-b-desktop.png`, `banca-b-catalogo-desktop.png`, `banca-b-localizacao-desktop.png`, `banca-b-produto-desktop.png`, `banca-a-mobile.png`, `banca-b-mobile.png`, `banca-b-catalogo-mobile.png` `tenant-invalido-blocked.png`, `platform-login-desktop.png`, `banca-b-login-desktop.png` e `banca-b-cliente-perfil-mobile.png`.

## Estado desta branch
O CI agora possui Chromium para capturas reais **da UI com fixtures**. Screenshots de staging integrado e produção continuam pendentes; ver distinção acima.

| Tela | Rota alvo | Tenant | Viewport | Estado |
|---|---|---|---|---|
| Área pública | `/banca-ana-maria` | Tenant A | mobile + desktop | PENDENTE — screenshot real |
| Catálogo | `/banca-ana-maria/catalogo` | Tenant A | mobile + desktop | PENDENTE — screenshot real |
| Reserva do cliente | `/banca-ana-maria/cliente/reservas` | Tenant A | mobile | PENDENTE — screenshot real |
| Painel local | `/banca-ana-maria/painel` | Tenant A | mobile + desktop | PENDENTE — screenshot real |
| Platform Owner | `/admin` | global | desktop | PENDENTE — screenshot real |
| Área pública Tenant B | `/<tenant-b-slug>` | Tenant B | mobile + desktop | PENDENTE — após fixture/emulator |

Nenhum arquivo de imagem é referenciado enquanto a captura não existir.
