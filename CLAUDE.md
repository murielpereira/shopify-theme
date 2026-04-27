# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Shopify Online Store 2.0 theme for **Âme Acessórios Pet**, a luxury pet-accessories store. Forked from Shopify's Skeleton Theme and heavily customized. The store sells leather collars, harnesses, and add-on identification pendants ("pingentes"). All UI strings are written directly in Brazilian Portuguese — `locales/pt-BR.json` is empty and unused. Do not introduce translation keys (`{{ '...' | t }}`); copy the surrounding pattern of hardcoded PT-BR text.

The visual language ("Aerodynamic Elegance") is documented in [instructions.md](instructions.md) and lived-in via design tokens in [snippets/css-variables.liquid](snippets/css-variables.liquid). Color palette is cream/brown with `--color-primary: #5a4742`. Avoid 100% black (`#000`); use `--color-on-background: #201b14`.

## Development commands

This is a Shopify theme — no build step, no test runner. The Shopify CLI handles dev preview and uploads.

```bash
shopify theme dev        # local preview against the connected dev store
shopify theme push       # upload to dev/staging theme on the store
shopify theme pull       # pull settings_data.json + templates back from store
shopify theme check      # run theme-check linter (matches CI)
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) only runs `shopify/theme-check-action`. There are no unit tests; `playwright` in `package.json` is unused infra.

The user typically asks Claude to make changes locally, then themselves runs `shopify theme push` and reports the rendered result back (often via screenshots). Do not attempt to push or upload — the user controls deployment.

## Architecture quirks worth knowing

### `assets/critical.css` is the global stylesheet
Everything that's *not* scoped to a single section/snippet lives there. New section-specific styles go in `<style>` (or `{% stylesheet %}` if not inside a conditional) inside the section file itself. **`{% stylesheet %}` cannot be nested inside `{% if %}`** — Shopify rejects it at validation. Snippets that conditionally render should use plain `<style>` tags instead.

### Product page: Section Rendering API for variants (>250-variant safe)
[sections/product.liquid](sections/product.liquid) does **not** dump `{{ product.variants | json }}`. Variant picking uses Shopify's [Section Rendering API](https://shopify.dev/docs/storefronts/themes/architecture/templates/product#section-rendering): on click, the JS reads `data-option-value-id` from buttons, fetches `/products/<handle>?section_id=<id>&option_values=<ids>`, and DOM-swaps four fixed wrappers from the response:

- `#pdp-options-wrap`   — variant picker (refreshes availability + selected state)
- `#pdp-price-block`    — price, compare-at, discount badge, PIX, installments, cashback
- `#pdp-add-btn-wrap`   — submit button enabled/disabled + label
- `#pdp-img-badge-wrap` — discount badge over the main image

After a successful refresh, the section dispatches `document.dispatchEvent(new CustomEvent('pdp:variant-changed'))`. Other on-page modules (the pingente snippet) listen to this event to re-validate. **Preserve these IDs** when refactoring; the JS depends on them.

### Cart: AJAX with `items: []` JSON, plus client-rendered drawer
The PDP submit handler in [sections/product.liquid](sections/product.liquid) builds a JSON payload (`{ items: [coleira, pingente?] }`) — *not* `FormData` — so it can post multiple items in one atomic call. After success, it calls `window.AmeCart.refresh(cartData)` and `window.AmeCart.open()`, both defined in [layout/theme.liquid](layout/theme.liquid). The drawer template exists in two places that must stay in sync:

- [snippets/cart-drawer.liquid](snippets/cart-drawer.liquid) — initial server-rendered Liquid
- `itemHTML()` in [layout/theme.liquid](layout/theme.liquid) — JS template-literal version used after AJAX add/update

Any change to a cart line's structure (e.g. adding line item properties, badges) must be applied in **both** places.

### Pingente personalizado (custom add-on flow)
[snippets/pingente-customization.liquid](snippets/pingente-customization.liquid) renders a progressive-disclosure block on products with the tag `customizacao_pingente`. It exposes `window.amePingente.{ isActive, validate, getCartItem }` which the product submit handler consults to add a *second* cart item alongside the collar. Pingente product handles follow a strict naming convention:

- `pingente-de-metal-para-identificacao-pet`
- `pingente-de-couro-para-identificacao-pet-<slug-cor>`
- `pingente-de-metal-com-couro-para-identificacao-pet-<slug-cor>`

The `<slug-cor>` is the *last* word of the collar's `Cor` option (split on `" com "`, slugified). Variant options inside each pingente product must be exactly `Cor do Metal`, `Formato`, `Tamanho`. Collar size → pingente size mapping is hardcoded in `SIZE_MAP`: XPP/XPP+/PP/P → P; M/G → G.

### Custom fields on collars
Theme settings define up to 10 generic custom fields (`custom_field_1_*` through `custom_field_10_*`) gated by tag (`custom_field_N_tag`). [sections/product.liquid](sections/product.liquid) renders fields whose tag is in `product.tags`. Each field's `_label` is the visible label, `_placeholder` is the input placeholder (falls back to label for back-compat). The fields submit as `name="properties[<cf_name>]"` — line item properties on the collar item. To hide a property from the customer-facing cart but keep it on the order, prefix the internal name with `_`.

### Money formatting
Calculations are done in cents (integer). Display uses `money_without_currency` filter (respects shop's locale: BRL → `1.820,50`). Avoid `round: 1 | replace: '.', ','` — that produces `18,2` instead of `18,20`. The `Shopify.formatMoney` JS helper is available client-side.

### Material Symbols icons
Loaded via Google Fonts in [snippets/css-variables.liquid](snippets/css-variables.liquid) with `&display=block` (not `swap`). This is intentional: icons render via ligatures, so `swap` would briefly show literal text like "shopping_bag" while the font loads. **Do not** change to `swap`. Lexend (the body font) uses `swap` correctly because text fallback is acceptable.

### Settings schema gotchas
- A bad value in `config/settings_data.json` (e.g. `"type_primary_font": "lexend_n4"` when Shopify doesn't recognize the handle) makes the entire theme settings panel render blank. Symptoms: empty panel + Shopify CLI error "New schema is incompatible with the current setting value".
- Shopify's `range` settings have a soft limit of ~100 stops. `(max - min) / step` must stay under that, and step needs to evenly divide the range to make `max` reachable.
- After modifying schema files via PowerShell/scripts, re-validate the JSON parses (`node -e "JSON.parse(...)"`) before pushing. The auto-edits in this codebase have produced double-comma JSON before.

### `.Jules/*.md` are agent review memories
Files in [.Jules/](.Jules/) (`bolt.md` = performance, `palette.md` = accessibility, `sentinel.md` = security) accumulate "Learning / Action / Prevention" notes from prior automated reviews of this repo. They reflect real bugs that were fixed — read them when working on the relevant area (e.g. `sentinel.md` when adding form input rendering, `palette.md` when touching interactive ARIA, `bolt.md` when iterating over collections). Do not overwrite or delete them.

### Reference projects (gitignored)
The `referencias/` and `nuvemshop/` directories are gitignored — they contain unrelated reference code (a Node app called `Waltz`, a Nuvemshop theme used for inspiration on the cashback snippet). Do not edit them and do not include their files in greps when working on the live theme.

## Communication conventions

The user works in Brazilian Portuguese. Replies, commit messages, and code comments destined for the user should be in PT-BR. Code identifiers stay in English/Portuguese mix as already used (`card_compare_price`, `pdp__price-block`, etc.). Don't translate existing identifiers.
