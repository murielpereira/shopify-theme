## 2024-05-17 - Missing button type attributes
**Learning:** Found that custom navigation buttons without explicit `type="button"` declarations (e.g., in `.pdp__nav` components) are present in the codebase. By default, buttons act as submit buttons, which can lead to unwanted form submissions if they are later wrapped in a form element.
**Action:** Always ensure that interactive UI elements meant purely for navigation or triggering JS logic explicitly declare `type="button"` to avoid potential conflicts.
## 2024-05-07 - Add aria-hidden to decorative icons
**Learning:** Found instances where material symbols (like `expand_more` in select dropdowns) were missing `aria-hidden="true"`, causing screen readers to improperly announce them as the ligature text.
**Action:** Ensure all decorative `<span class="material-symbols-outlined">` elements are accompanied by `aria-hidden="true"` when placed next to visually meaningful text or inputs.
## 2024-05-18 - Missing native tooltips on icon-only buttons
**Learning:** Found that while icon-only buttons correctly utilized `aria-label` for screen reader accessibility, they lacked `title` attributes. This meant sighted users relying on a mouse would not get visual tooltip feedback on hover, potentially causing confusion regarding the button's action.
**Action:** Always add native `title` tooltips matching the `aria-label` text to icon-only buttons or interactive elements to ensure visual clarity for all users.
## 2024-05-14 - Icon-only buttons lacking native tooltips
**Learning:** Icon-only buttons had `aria-label` for screen readers but lacked a native visual `title` tooltip. This caused sighted mouse users to have to guess the action of certain icons (e.g., '+' or '-' for quantities, or 'close' icons).
**Action:** Always mirror `aria-label` content into a native `title` attribute for purely icon-based interactive elements to ensure both screen reader and sighted mouse users can identify the action.
## 2024-05-13 - Add aria-pressed to custom selection buttons
**Learning:** Found that custom selection buttons (like product swatches and size selectors) used CSS classes to indicate active state, but lacked the `aria-pressed` attribute, leaving screen reader users unaware of which option was currently selected. Additionally, disabled options did not clearly announce their unavailable status.
**Action:** Always add `aria-pressed="true/false"` to custom toggle/selection buttons and ensure the state is kept in sync via JavaScript. For unavailable options, add `aria-disabled="true"` and explicitly append "(Esgotado)" or similar to the `aria-label` and `title` attributes.

## 2024-05-20 - Cart Drawer Accessibility Refinements
**Learning:** Dialog components and input feedbacks in Shopify themes often miss critical ARIA linkages (`aria-modal="true"` and `aria-describedby`), reducing screen reader context.
**Action:** Always ensure `role="dialog"` is paired with `aria-modal="true"`, and connect dynamic feedback elements to their respective inputs using `aria-describedby` and `id`.

## 2024-05-24 - Cart Toggle Button Accessibility
**Learning:** Modal and drawer toggle buttons (like the cart button) require `type="button"` to prevent accidental form submission, as well as `aria-expanded` and `aria-controls` to properly announce their state and target to screen readers.
**Action:** When implementing new UI toggles for menus, search overlays, or drawers, always ensure `type="button"` is set, `aria-controls` links to the container ID, and `aria-expanded` is dynamically updated via JavaScript.

## 2024-05-24 - Search Toggle Button Accessibility
**Learning:** The header search toggle button lacked `aria-controls` and `aria-expanded` attributes. This meant screen readers had no way to know if the search overlay was currently open or what section of the page the button actually controlled.
**Action:** Always add `aria-expanded="false"` (or `"true"`) and `aria-controls="[id]"` to button elements that toggle the visibility of modals, overlays, or drawers. Ensure the `aria-expanded` attribute is kept in sync via Javascript during open/close logic.

## 2024-05-25 - Mobile Menu Accessibility Links
**Learning:** Found that the mobile menu toggle buttons (both the main header button and submenu toggle buttons) did not have `aria-controls` connecting them to their respective containers. For submenus inside a loop, dynamically generating `id`s using `forloop.index` is an effective way to maintain unique ARIA links.
**Action:** When working with toggle buttons that reveal hidden sections (menus, drawers, accordions), especially within a Liquid loop, ensure to use `aria-controls` linked to a dynamically generated `id` (e.g., `id="mobile-submenu-{{ forloop.index }}"`).
