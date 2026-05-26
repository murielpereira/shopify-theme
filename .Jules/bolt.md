## 2024-05-21 - Optimize product media filtering

**Learning:** When calculating properties from large Shopify objects like `product.media` in Liquid, using manual iterative `{% for %}` loops to check conditions (like matching strings against `media_type`) scales poorly as the array size increases. The Liquid parser is slow and overhead adds up quickly during backend render.

**Action:** Always prefer Liquid's native array filters (like `where`, `map`, `join`) instead of manual loops. Native filters are executed at the C/Rust level, bypassing the Liquid interpreter loop and vastly improving Time to First Byte (TTFB). For instance, replace conditional counter loops with `array | where: 'property', 'value' | size`.

## 2024-05-24 - Unobserve IntersectionObserver after scroll reveal
**Learning:** The scroll reveal implementation using IntersectionObserver was leaving the observer attached to elements even after they became visible. This anti-pattern can cause main-thread scroll performance bottlenecks because the browser keeps evaluating the intersection on every scroll tick for elements that have already animated.
**Action:** Always call io.unobserve(e.target) when an intersection check succeeds for a one-time animation to free up memory and prevent main-thread leaks.
