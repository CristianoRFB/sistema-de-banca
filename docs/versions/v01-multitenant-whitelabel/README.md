# SaaS Banca — v01 Multi-Tenant White-Label

Versão canônica da transformação do sistema de banca em SaaS Multi-Tenant White-Label.

## Objetivo
Preservar a operação existente da Banca Ana Maria enquanto o mesmo código passa a suportar múltiplas bancas isoladas por tenant.

## Escopo desta versão
- Tenant Resolver por slug;
- backend tenant-aware;
- memberships/RBAC;
- Platform Owner mínimo;
- cliente/sessões/índices tenant-aware;
- jobs e PWA/cache tenant-aware;
- white-label básico;
- migração aditiva da banca original;
- Tenant B para testes;
- documentação e evidências técnicas.

## Fora desta versão
PlanCatalog, EntitlementService, gating comercial, billing, gateway, trial runtime, DemoMode e delivery/driver.

Consulte STATUS.md antes de interpretar qualquer item como publicado em produção.
