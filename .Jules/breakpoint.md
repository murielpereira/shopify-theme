## 2026-05-20 - [Fix Swatches Layout Overflow]
**Learning:** Found a recurring layout issue pattern where fixed column grid layouts (e.g. `grid-template-columns: repeat(6, 1fr)`) fail to fit gracefully when content exceeds available width or when there is insufficient padding/gap on mobile, resulting in truncated items.
**Action:** Use a flexbox wrapper with `flex-wrap: wrap` and percentage-based `width` values calculated via `calc()` based on the column count and gap (e.g., `width: calc(16.666% - 5px)` for 6 columns) to allow seamless wrapping while maintaining layout integrity.

## 2024-05-18 - Mobile Grid Squishing in Shopify Theme
**Learning:** Hardcoding CSS Grid columns (e.g. `grid-template-columns: repeat(4, 1fr)`) without adjusting the count for small screens (max-width: 480px) causes severe content squishing or overflow.
**Action:** When fixing overflowing mobile CSS grids, adjust the `grid-template-columns` property within an `@media` query (e.g. dropping down to `repeat(2, 1fr)`) rather than rewriting the component's layout engine to Flexbox with manually calculated widths.

## 2026-05-20 - Avoid max-width: 100vw to prevent horizontal scrolling
**Learning:** Using `max-width: 100vw` on full-width sticky or fixed headers (like `.ame-announce` and `.ame-header-group`) causes horizontal overflow issues on operating systems with visible vertical scrollbars (e.g. Windows). The vertical scrollbar takes up some width, so `100vw` ends up wider than the available 100% width, causing a horizontal scrollbar.
**Action:** Remove `max-width: 100vw` when `width: 100%` is already defined along with `left: 0; right: 0;`. `100%` is sufficient and responsive without causing overflow.

## 2024-06-10 - Mobile CSS Grid Squishing Fix
**Learning:** Hardcoding `grid-template-columns: repeat(3, 1fr)` causes content squishing on small mobile screens, violating the mobile-first approach.
**Action:** Default to `grid-template-columns: repeat(2, 1fr)` or `1fr` in the CSS grid container to allow wrapping on mobile, and apply the multi-column layout using a progressive enhancement media query like `@media (min-width: 600px)` for tablet and desktop views.
