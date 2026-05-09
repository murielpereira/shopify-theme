## 2023-10-27 - Remove horizontal scroll caused by fixed width 100vw

**Learning:** Using `width: 100vw` combined with `margin-left: calc(50% - 50vw)` to break out of a constrained container and create a full-bleed layout causes horizontal scrollbars on operating systems with visible vertical scrollbars (like Windows and Linux), because `100vw` includes the scrollbar width.
**Action:** Achieve full-bleed sections by using `width: auto` alongside negative horizontal margins matching the container's padding (e.g., `calc(-1 * var(--page-margin))`). Avoid using `vw` units for horizontal sizing when a vertical scrollbar might be present.
