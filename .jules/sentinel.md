## 2024-05-18 - [Missing noreferrer in target="_blank" links]
**Vulnerability:** Some external links using `target="_blank"` only had `rel="noopener"`, omitting `noreferrer`.
**Learning:** While `noopener` prevents the new page from accessing the `window.opener` object, omitting `noreferrer` can still leak the Referer header (which may contain sensitive information in the URL) to the external site, posing a privacy risk. Both should always be used together for external links.
**Prevention:** Always use `rel="noopener noreferrer"` when using `target="_blank"`. Added this to the project's coding conventions check.
