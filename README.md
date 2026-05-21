<h1 align="center">🐾 Âme Acessórios Pet</h1>

<p align="center">
  <strong>Tema Shopify customizado da <a href="https://ame-acessorios-pet.myshopify.com">loja Âme Acessórios Pet</a></strong><br>
  <em>Acessórios artesanais de luxo para pets — coleiras de couro, peitorais, almofadas e pingentes personalizados.</em>
</p>

<p align="center">
  <img alt="Shopify" src="https://img.shields.io/badge/Shopify-OS%202.0-95BF47?style=flat-square&logo=shopify&logoColor=white">
  <img alt="Liquid" src="https://img.shields.io/badge/Liquid-template-9333ea?style=flat-square">
  <img alt="Idioma" src="https://img.shields.io/badge/Idioma-PT--BR-FFCD3C?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/Licen%C3%A7a-MIT-5a4742?style=flat-square">
  <a href="./.github/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/badge/CI-theme--check-blue?style=flat-square"></a>
</p>

<p align="center">
  <a href="#-começando">Começando</a> •
  <a href="#-recursos">Recursos</a> •
  <a href="#-performance">Performance</a> •
  <a href="#%EF%B8%8F-arquitetura">Arquitetura</a> •
  <a href="#-convenções">Convenções</a>
</p>

---

> 🍂 **Identidade visual** — "Aerodynamic Elegance". Paleta cream/brown com `--color-primary: #5a4742`. Evite `#000` puro — use `--color-on-background: #201b14`. Tipografia: **Lexend** (self-hosted). Tokens em [`snippets/css-variables.liquid`](snippets/css-variables.liquid).

> 🇧🇷 **Sem i18n** — Todo o conteúdo (strings, comentários, schema labels) está em **português do Brasil** direto. `locales/pt-BR.json` existe mas está vazio. Nunca use `{{ '...' | t }}` — copie o padrão de hardcoded PT-BR dos arquivos existentes.

---

## 🚀 Começando

### Pré-requisitos

| Ferramenta | Função |
|---|---|
| [Shopify CLI](https://shopify.dev/docs/api/shopify-cli) | Preview, push, pull e gestão do tema |
| [Shopify Liquid (VS Code)](https://shopify.dev/docs/storefronts/themes/tools/shopify-liquid-vscode) | Syntax highlight + lint + autocomplete *(opcional, recomendado)* |

### Comandos do dia-a-dia

```bash
shopify theme dev       # 🔧 preview local conectado ao dev store
shopify theme push      # 📤 sobe pro tema de testes
shopify theme pull      # 📥 baixa settings_data.json + templates do admin
shopify theme check     # ✅ linter (mesmo que roda no CI)
```

**Fluxo padrão:** editar localmente → `shopify theme push` → conferir no navegador (geralmente confirmando via screenshot). A CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) roda apenas `shopify/theme-check-action` — não há testes unitários nem Playwright (apesar do `package.json` mencionar).

---

## ✨ Recursos

### 🛒 Página de produto (PDP)

| Feature | O que faz | Onde mora |
|---|---|---|
| 🔁 **Section Rendering API** | Re-renderiza 4 wrappers (`#pdp-options-wrap`, `#pdp-price-block`, `#pdp-add-btn-wrap`, `#pdp-img-badge-wrap`) na troca de variante. Suporta >250 variantes sem dump de JSON. | [`sections/product.liquid`](sections/product.liquid) |
| 🏷️ **Pingente personalizado** | Adiciona segundo item ao carrinho (coleira + pingente) com cor/tamanho mapeados automaticamente. | [`snippets/pingente-customization.liquid`](snippets/pingente-customization.liquid) |
| 📝 **Custom fields por tag** | Até 11 campos opcionais (nome do pet, telefone do tutor, etc.) que aparecem só nos produtos com a tag correspondente. | [`sections/product.liquid`](sections/product.liquid) |
| ❓ **FAQ híbrido** | Perguntas globais (section blocks) + específicas (metafield `custom.faq` rich text). Cada FAQ global pode ser restrita por tag. | [`sections/product-accordions.liquid`](sections/product-accordions.liquid) |
| 📦 **"Depois da compra"** | Até 8 etapas com emoji + texto, cada uma com filtro de tag opcional. | [`sections/product-accordions.liquid`](sections/product-accordions.liquid) |
| 🔕 **Tag "Esgotado"** | Automática nos cards e PDP quando todas as variantes estão sem estoque. CTA vira "Produto esgotado" cinza e não-clicável. Variantes esgotadas continuam selecionáveis pra acionar app "Avise-me quando chegar". | [`snippets/product-card.liquid`](snippets/product-card.liquid), [`sections/product.liquid`](sections/product.liquid) |

### 🛍️ Carrinho

- **AJAX com `items: []`** — suporta múltiplos itens atômicos (coleira + pingente em uma só chamada).
- **Drawer híbrido** — Liquid server-rendered em [`snippets/cart-drawer.liquid`](snippets/cart-drawer.liquid) + JS template literal em `itemHTML()` no [`layout/theme.liquid`](layout/theme.liquid) (após AJAX add).
- ⚠️ **As duas versões do drawer precisam ficar em sincronia** — qualquer mudança numa estrutura de linha tem que ser replicada na outra.

### 🏠 Home

- 🎠 **Hero carrossel próprio** — múltiplos slides com agendamento por datetime no Liquid (start/end). [`blocks/ame_hero_carousel.liquid`](blocks/ame_hero_carousel.liquid)
- 🎬 **Stories de vídeo** em 3 formatos:
  - **Stories** (círculos estilo Instagram)
  - **Carrossel** (cards 9:16)
  - **Spotlight** (card central destacado com loop infinito + autoplay)

  [`snippets/video-stories.liquid`](snippets/video-stories.liquid)

### 💝 Outros

- ❤️ **Página de favoritos** — wishlist client-side via `localStorage`. Cards renderizados via `/products/<handle>?view=card` (template [`templates/product.card.liquid`](templates/product.card.liquid) com `{% layout none %}` retorna só o markup do `product-card`).
- 🔔 **Ícone de favoritos no header** com contador sincronizado entre abas via evento `storage`.
- 💰 **Cashback** configurável (% e valor mínimo), exibido em cards e PDP.

---

## 🎨 Performance

### Fontes self-hosted

| Fonte | Subset | Tamanho | Motivo |
|---|---|---|---|
| **Lexend** (variable) | `latin` + `latin-ext` separados por `unicode-range` | ~150KB total | LGPD, CDN Shopify mais próximo do BR que `fonts.gstatic.com`, sem preconnect com `fonts.googleapis.com` |
| **Material Symbols** | Apenas os ícones em uso | 13KB (era 3.8MB no full) | Render-blocking minimizado |

> ⚠️ **Atenção ao adicionar ícones Material Symbols:** é **obrigatório regenerar o subset** baixando o `.woff2` atualizado. Caso contrário o ícone renderiza como **texto literal** (ex: `progress_activity` aparece girando como texto). Instruções completas em [`snippets/css-variables.liquid`](snippets/css-variables.liquid).

### CSS

- **Crítico global** em [`assets/critical.css`](assets/critical.css) — tudo que não é específico de section/snippet vive aqui.
- **Específico** em `<style>` ou `{% stylesheet %}` dentro do próprio arquivo.
- ⚠️ **Não use `{% stylesheet %}` dentro de `{% if %}`** — Shopify rejeita na validação. Use `<style>` plano em snippets condicionais.

---

## 🏗️ Arquitetura

```
📦 shopify-theme/
 ├── 📁 assets/         # CSS crítico, JS, fontes self-hosted, ícones SVG
 ├── 📁 blocks/         # Componentes nesteáveis (hero carrossel, blocos AI-gen)
 ├── 📁 config/         # settings_schema.json, settings_data.json (auto-gerado)
 ├── 📁 layout/         # theme.liquid (com cart drawer JS template)
 ├── 📁 locales/        # ⚠️ Vazios — conteúdo é PT-BR direto
 ├── 📁 sections/       # Componentes de página com schema customizável
 ├── 📁 snippets/       # Liquid reutilizável (cart drawer, product card, pingente)
 ├── 📁 templates/      # JSON e Liquid de cada tipo de página
 └── 📁 .Jules/         # Memórias de revisões automatizadas (perf, a11y, security)
```

### Templates de produto

| Template | Uso |
|---|---|
| [`templates/product.json`](templates/product.json) | Template padrão (produto comum) |
| [`templates/product.card.liquid`](templates/product.card.liquid) | Alternativo com `{% layout none %}` — acessado via `?view=card` pra entregar só o markup do card. Usado pela página de favoritos pra montar grids client-side. |

---

## 📐 Convenções

| Regra | Detalhe |
|---|---|
| 🇧🇷 **PT-BR direto** | Nada de `{{ '...' | t }}`. Copie o padrão dos arquivos existentes. |
| 🎨 **Cor** | Evite `#000` puro — use `--color-on-background: #201b14`. Primária: `--color-primary: #5a4742`. |
| 🚫 **`{% stylesheet %}` em `if`** | Shopify rejeita na validação. Use `<style>` plano em snippets condicionais. |
| 📂 **`config/settings_data.json`** | Auto-gerado pelo admin do Shopify — **não edite manualmente**. Se editar via script, valide o JSON antes de subir. |
| 💰 **Money** | Calcule em centavos (inteiro). Exiba via `money_without_currency` (respeita locale BRL → `1.820,50`). Evite `round: 1 \| replace: '.', ','` (produz `18,2` em vez de `18,20`). |
| 📋 **Tags** | Case-sensitive no código — use minúsculas sem acento (`lancamento`, não `Lançamento`). |

### Documentação interna

- 📖 **[CLAUDE.md](CLAUDE.md)** — detalhes técnicos profundos, quirks da arquitetura, instruções pra agentes de IA.
- 🤖 **[`.Jules/`](.Jules/)** — memórias acumuladas de revisões automatizadas:
  - `bolt.md` → performance
  - `palette.md` → acessibilidade
  - `sentinel.md` → segurança

---

## 📄 Licença

[MIT](./LICENSE.md) — herdada do [Shopify Skeleton Theme](https://github.com/Shopify/skeleton-theme).

---

<p align="center">
  <em>Feito com 🤎 para a Âme Acessórios Pet.</em>
</p>
