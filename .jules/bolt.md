## 2024-05-24 - Liquid Snippet N+1 Overhead
**Learning:** Rendering snippets (e.g., `{% render 'image' %}`) inside `for` loops in Shopify Liquid introduces significant overhead due to parsing and scoping per iteration, effectively causing an N+1 rendering bottleneck for templates with many items like collections, search results, or large carts.
**Action:** Always inline simple HTML logic using native Liquid filters like `image_url` and `image_tag` instead of using snippet renders inside loops to improve template compilation and server response time.
