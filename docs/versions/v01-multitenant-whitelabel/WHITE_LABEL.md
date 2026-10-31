# WHITE LABEL

## Implementado na branch
O bootstrap público retorna configuração segura de tenant:
- nome;
- telefone;
- endereço;
- imagem/logo por URL;
- primaryColor;
- accentColor;
- backgroundColor;
- textColor;
- tagline.

O shell público e o shell administrativo aplicam identidade básica do tenant.

## Shared PWA
Manifest e HTML iniciais são neutros (`SaaS Banca`). O runtime atualiza o título e identidade depois de resolver o tenant.

## Tenant A
Os defaults existentes preservam a identidade histórica da Banca Ana Maria durante a migração.

## Limites desta versão
White-label avançado, custom domain automatizado e gating por plano ficam fora deste core.
