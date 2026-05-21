# Âme Acessórios Pet — Tema Shopify

Tema da loja [ame-acessorios-pet.myshopify.com](https://ame-acessorios-pet.myshopify.com), especializada em acessórios pet artesanais de luxo (coleiras de couro, peitorais, almofadas e pingentes personalizados de identificação).

Fork do [Shopify Skeleton Theme](https://github.com/Shopify/skeleton-theme) com customizações pesadas. Todo o conteúdo do tema (strings, comentários, schema labels) está em **português do Brasil** — não há sistema de i18n.

## Começando

### Pré-requisitos

- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli)
- [Extensão Shopify Liquid pra VS Code](https://shopify.dev/docs/storefronts/themes/tools/shopify-liquid-vscode) (recomendado)

### Desenvolvimento

```bash
shopify theme dev        # preview local conectado ao dev store
shopify theme push       # sobe pro tema de testes
shopify theme pull       # baixa settings_data.json + templates do admin
shopify theme check      # linter (mesmo que roda no CI)
```

O fluxo normal: editar localmente → `shopify theme push` → conferir no navegador. A CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) roda apenas `theme-check`; não há testes unitários.

## Recursos do tema

### Página de produto (PDP)
- **Section Rendering API** pra seletor de variantes — suporta produtos com >250 variantes sem dump de JSON. Quatro wrappers (`#pdp-options-wrap`, `#pdp-price-block`, `#pdp-add-btn-wrap`, `#pdp-img-badge-wrap`) são re-renderizados no clique.
- **Pingente personalizado** ([snippets/pingente-customization.liquid](snippets/pingente-customization.liquid)) — adiciona um segundo item ao carrinho (coleira + pingente) com mapeamento de cor/tamanho automático.
- **Campos personalizados por tag** — até 11 campos configuráveis ([sections/product.liquid](sections/product.liquid)) que aparecem apenas em produtos com a tag correspondente.
- **FAQ híbrido** — perguntas globais via section blocks + perguntas específicas via metafield `custom.faq` (rich text). Cada FAQ global pode ser restrita a produtos com tags específicas.
- **"Depois da compra"** — até 8 etapas configuráveis com emoji + texto, cada uma com filtro de tag opcional.
- **Tag "Esgotado"** automática nos cards e PDP quando todas as variantes estão sem estoque.

### Carrinho
- AJAX com `items: []` (suporta múltiplos itens atômicos pra coleira+pingente).
- Drawer híbrido: Liquid em [snippets/cart-drawer.liquid](snippets/cart-drawer.liquid) (server-rendered) + template literal em `itemHTML()` no [layout/theme.liquid](layout/theme.liquid) (após AJAX). **As duas versões precisam ficar em sincronia.**

### Home
- **Hero carrossel próprio** ([blocks/ame_hero_carousel.liquid](blocks/ame_hero_carousel.liquid)) com múltiplos slides e agendamento por datetime no Liquid.
- **Stories de vídeo** ([snippets/video-stories.liquid](snippets/video-stories.liquid)) em 3 formatos: stories (círculos), carrossel (cards 9:16), spotlight (card central destacado com loop infinito).

### Outros
- **Página de favoritos** ([sections/favoritos.liquid](sections/favoritos.liquid)) — wishlist client-side via `localStorage`, com cards renderizados via `/products/<handle>?view=card` (template `templates/product.card.liquid` com `{% layout none %}`).
- **Ícone de favoritos no header** com contador sincronizado entre abas via evento `storage`.
- **Cashback** configurável por % e valor mínimo, exibido em cards e PDP.

## Performance e fontes

- **Lexend self-hosted** ([assets/lexend-latin.woff2](assets/lexend-latin.woff2) + latin-ext) com `font-display: swap` e `unicode-range` separando ASCII de acentos PT-BR.
- **Material Symbols subset** ([assets/material-symbols-subset.woff2](assets/material-symbols-subset.woff2)) com apenas os ícones em uso. **Ao adicionar um ícone novo no Liquid/JS, é obrigatório regenerar o subset** — caso contrário ele renderiza como texto literal (ex: `delete`). Instruções completas em [snippets/css-variables.liquid](snippets/css-variables.liquid).
- **CSS crítico** em [assets/critical.css](assets/critical.css) (global). Estilos específicos de section ficam em `<style>`/`{% stylesheet %}` dentro do próprio arquivo.

## Arquitetura

```
.
├── assets          # CSS, JS, fontes self-hosted, ícones
├── blocks          # Componentes reutilizáveis (hero carrossel, blocos AI-gen)
├── config          # settings_schema.json, settings_data.json
├── layout          # theme.liquid (com cart drawer JS template)
├── locales         # vazios — todo o conteúdo é PT-BR direto
├── sections        # Componentes de página com schema customizável
├── snippets        # Liquid reutilizável (cart drawer, product card, pingente)
└── templates       # JSON e Liquid de cada tipo de página
```

### Templates de produto

- [`templates/product.json`](templates/product.json) — template padrão (produto comum).
- [`templates/product.card.liquid`](templates/product.card.liquid) — alternativo com `{% layout none %}`. Acessado via `?view=card` pra entregar só o markup do card (usado pela página de favoritos pra montar grids client-side).

## Convenções

- **PT-BR direto no código**: nada de `{{ '...' | t }}`. Copie o padrão dos arquivos existentes.
- **Cor:** evite `#000` puro — use `--color-on-background: #201b14`. A primária é `--color-primary: #5a4742` (marrom).
- **Sem `{% stylesheet %}` dentro de `{% if %}`** — Shopify rejeita na validação. Use `<style>` plano em snippets condicionais.
- **`config/settings_data.json` é auto-gerado** pelo admin do Shopify — não edite manualmente, e se editar via script, valide o JSON antes de subir.
- **Documentação interna**: [CLAUDE.md](CLAUDE.md) tem detalhes técnicos profundos e quirks. Pastas [`.Jules/`](.Jules/) acumulam memórias de revisões automatizadas (performance, acessibilidade, segurança).

## Licença

[MIT](./LICENSE.md) — herdada do Skeleton Theme.
