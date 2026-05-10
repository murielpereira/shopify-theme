## 2024-05-17 - Missing button type attributes
**Learning:** Found that custom navigation buttons without explicit `type="button"` declarations (e.g., in `.pdp__nav` components) are present in the codebase. By default, buttons act as submit buttons, which can lead to unwanted form submissions if they are later wrapped in a form element.
**Action:** Always ensure that interactive UI elements meant purely for navigation or triggering JS logic explicitly declare `type="button"` to avoid potential conflicts.
## 2024-05-07 - Add aria-hidden to decorative icons
**Learning:** Found instances where material symbols (like `expand_more` in select dropdowns) were missing `aria-hidden="true"`, causing screen readers to improperly announce them as the ligature text.
**Action:** Ensure all decorative `<span class="material-symbols-outlined">` elements are accompanied by `aria-hidden="true"` when placed next to visually meaningful text or inputs.
## 2025-02-12 - Visual tooltips for icon-only buttons
**Learning:** Found that while icon-only buttons had `aria-label` attributes for screen readers, they lacked `title` attributes, meaning sighted mouse users would not see a native tooltip on hover explaining the button's action.
**Action:** Always include a `title` attribute that matches the `aria-label` text on icon-only buttons to provide visual tooltips on hover for sighted users.
