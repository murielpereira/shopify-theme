## 2024-05-21 - Optimize product media filtering

**Learning:** When calculating properties from large Shopify objects like `product.media` in Liquid, using manual iterative `{% for %}` loops to check conditions (like matching strings against `media_type`) scales poorly as the array size increases. The Liquid parser is slow and overhead adds up quickly during backend render.

**Action:** Always prefer Liquid's native array filters (like `where`, `map`, `join`) instead of manual loops. Native filters are executed at the C/Rust level, bypassing the Liquid interpreter loop and vastly improving Time to First Byte (TTFB). For instance, replace conditional counter loops with `array | where: 'property', 'value' | size`.

## 2024-05-24 - Single pass strategy with {% capture %} avoids duplicate iterations

**Learning:** Liquid processes manual `for` loops slowly. I found an anti-pattern in `sections/product-accordions.liquid` where settings blocks and `for i in (1..8)` loops were evaluated multiple times - first to detect boolean visibility flags, and second to render HTML elements. This duplicate evaluation scales poorly and increases Server Response Time/TTFB.
**Action:** When conditionally evaluating visibility variables inside Liquid iterations, avoid parsing the same arrays twice. Wrap the target loop with `{% capture html_variable %}`, evaluate the visibility internally alongside rendering the content, assign the flag, and inject the captured variable directly into the template where required.