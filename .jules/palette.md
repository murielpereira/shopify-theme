## 2024-05-17 - Missing button type attributes
**Learning:** Found that custom navigation buttons without explicit `type="button"` declarations (e.g., in `.pdp__nav` components) are present in the codebase. By default, buttons act as submit buttons, which can lead to unwanted form submissions if they are later wrapped in a form element.
**Action:** Always ensure that interactive UI elements meant purely for navigation or triggering JS logic explicitly declare `type="button"` to avoid potential conflicts.
