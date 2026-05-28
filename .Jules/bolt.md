## 2024-05-21 - Optimize product media filtering

**Learning:** When calculating properties from large Shopify objects like `product.media` in Liquid, using manual iterative `{% for %}` loops to check conditions (like matching strings against `media_type`) scales poorly as the array size increases. The Liquid parser is slow and overhead adds up quickly during backend render.

**Action:** Always prefer Liquid's native array filters (like `where`, `map`, `join`) instead of manual loops. Native filters are executed at the C/Rust level, bypassing the Liquid interpreter loop and vastly improving Time to First Byte (TTFB). For instance, replace conditional counter loops with `array | where: 'property', 'value' | size`.

## 2024-05-24 - Unobserve IntersectionObserver after scroll reveal
**Learning:** The scroll reveal implementation using IntersectionObserver was leaving the observer attached to elements even after they became visible. This anti-pattern can cause main-thread scroll performance bottlenecks because the browser keeps evaluating the intersection on every scroll tick for elements that have already animated.
**Action:** Always call io.unobserve(e.target) when an intersection check succeeds for a one-time animation to free up memory and prevent main-thread leaks.
## 2024-05-27 - Optimize conditional rendering loops in product accordions
**Learning:** Liquid loops that iterate over an array (such as string split arrays) and conditionally check product tags incur processing overhead. When the logic to check if a block should be visible is identical to the logic to render it, looping twice (once to set a visibility boolean flag and once to render) doubles the Liquid overhead.
**Action:** Use the `{% capture %}` strategy. Loop once, capture the generated HTML into a variable (like `after_purchase_steps_html`), strip it, and use its existence (`if after_purchase_steps_html != blank`) as the boolean flag instead of running the loop twice.
## 2024-05-28 - Optimize array sorting in Liquid templates
**Learning:** Shopify Liquid lacks a native way to sort complex objects or manually filter loop outputs based on dynamic numeric fields (like custom ordering fields in settings). Developers often resort to nested O(N²) loops (e.g. an outer loop for order position 1..20, and an inner loop over 20 fields to find matches) which bloats template evaluation time.
**Action:** Use an O(N) string-building approach. Loop once to build a comma-separated string of the active fields, prefixing each with a zero-padded sort key (e.g., `05_customField1`). Split this string and use the native `sort` filter. Then iterate over this much smaller, natively sorted array to render the output.
