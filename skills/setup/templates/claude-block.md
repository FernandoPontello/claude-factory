<!-- factory:inicio -->
## Factory

Este projeto usa a factory (plugin `factory`). PRDs vivem no Azure DevOps; `docs/system/` é o
mapa do sistema; a receita de execução está em `.factory/project.json`.

- Branches: `develop` só recebe de `feature/*`; `QA` recebe da develop e de `bugfix/*`; `main`
  recebe da QA e de `hotfix/*`. Nada entra nelas sem PR aprovada.
- Mudou um comportamento visível ou uma regra de arquitetura, mesmo numa sessão fora da factory?
  Atualize `docs/system/` na mesma PR.
<!-- factory:fim -->
