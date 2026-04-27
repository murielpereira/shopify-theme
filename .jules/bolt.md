## 2024-05-24 - Liquid Snippet N+1 Overhead
**Learning:** Rendering snippets (e.g., `{% render 'image' %}`) inside `for` loops in Shopify Liquid introduces significant overhead due to parsing and scoping per iteration, effectively causing an N+1 rendering bottleneck for templates with many items like collections, search results, or large carts.
**Action:** Always inline simple HTML logic using native Liquid filters like `image_url` and `image_tag` instead of using snippet renders inside loops to improve template compilation and server response time.
## 2024-05-25 - Liquid 'render for' Parameter Restriction
**Learning:** While the native `{% render 'snippet' for array as item %}` syntax is the optimal way to avoid N+1 rendering overhead in Shopify Liquid, it does *not* support passing additional variables (e.g., `card_btn_label: section.settings.card_btn_label`). Attempting to do so results in a compilation error.
**Action:** Always verify if a `render` tag inside a `for` loop passes additional parameters. If it does, you must fall back to the standard `for` loop and cannot use the `render for` optimization.
