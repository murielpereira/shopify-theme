## 2024-05-18 - [Missing noreferrer in target="_blank" links]
**Vulnerability:** Some external links using `target="_blank"` only had `rel="noopener"`, omitting `noreferrer`.
**Learning:** While `noopener` prevents the new page from accessing the `window.opener` object, omitting `noreferrer` can still leak the Referer header (which may contain sensitive information in the URL) to the external site, posing a privacy risk. Both should always be used together for external links.
**Prevention:** Always use `rel="noopener noreferrer"` when using `target="_blank"`. Added this to the project's coding conventions check.

## 2024-05-24 - [Reflected XSS in Liquid Localized Strings]
**Vulnerability:** Unsanitized user input (`search.terms`) was passed to Shopify translation strings ending in `_html`.
**Learning:** Shopify localizations with keys ending in `_html` output raw HTML directly, ignoring standard escaping if the parameters are not pre-escaped.
**Prevention:** Always use the `escape` filter on user input before passing it as arguments to `_html` translation keys (e.g., `{% assign escaped_terms = search.terms | escape %}`).

## 2024-04-27 - Fix Reflected XSS in form variables
**Vulnerability:** Reflected XSS vulnerability due to unescaped form variables (`form.author`, `form.email`, `form.body`) rendered back to the user in input tags in Shopify Liquid template `sections/article.liquid`.
**Learning:** Shopify Liquid does not auto-escape form variables. If the user submits malicious payload, the form payload might get directly injected to HTML elements.
**Prevention:** Always apply the `escape` filter (e.g. `{{ form.author | escape }}`) when outputting user input dynamically back to the user inside HTML tags or attributes.
