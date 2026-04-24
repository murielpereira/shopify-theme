## 2024-04-22 - Improved Interactive States and Focus Accessibility
**Learning:** The "Quick Add" button optimistically showed "Adicionado ✓" before the network request completed, leading to poor UX if the request failed or was slow. The wishlist button lacked semantic state (`aria-pressed`), and the global stylesheet was missing a visible focus indicator for keyboard users.
**Action:** Ensure async operations have clear loading states (`aria-busy="true"` and text updates) before indicating success. Always include `aria-pressed` for toggle buttons, and establish a clear `:focus-visible` baseline in `critical.css`.

## 2026-04-23 - Dynamic Element ARIA Consistency
**Learning:** Dynamically generated DOM elements (e.g., from AJAX cart updates) often miss ARIA attributes that were present in the initial server-rendered HTML, causing accessibility regressions on interaction.
**Action:** Always ensure client-side rendering logic mirrors the same accessibility attributes (like `aria-label` and `aria-hidden`) as the server-side templates.

## 2024-04-24 - Accessibility and Interactive States
**Learning:** Add-to-cart button missed communicating async loading to screen readers, and wishlist button lacked `aria-pressed` semantic state for its toggle functionality.
**Action:** Ensure async action buttons have `aria-busy="true"` added during requests and removed after completion/failure. Add `aria-pressed` and toggle it correctly for buttons acting as switches.
