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
