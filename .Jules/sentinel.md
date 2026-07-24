## 2024-05-18 - [Missing noreferrer in target="_blank" links]
**Vulnerability:** Some external links using `target="_blank"` only had `rel="noopener"`, omitting `noreferrer`.
**Learning:** While `noopener` prevents the new page from accessing the `window.opener` object, omitting `noreferrer` can still leak the Referer header (which may contain sensitive information in the URL) to the external site, posing a privacy risk. Both should always be used together for external links.
**Prevention:** Always use `rel="noopener noreferrer"` when using `target="_blank"`. Added this to the project's coding conventions check.

## 2024-05-24 - [Reflected XSS in Liquid Localized Strings]
**Vulnerability:** Unsanitized user input (`search.terms`) was passed to Shopify translation strings ending in `_html`.
**Learning:** Shopify localizations with keys ending in `_html` output raw HTML directly, ignoring standard escaping if the parameters are not pre-escaped.
**Prevention:** Always use the `escape` filter on user input before passing it as arguments to `_html` translation keys (e.g., `{% assign escaped_terms = search.terms | escape %}`).

## 2024-05-25 - [Reflected XSS in Shopify Form Variables]
**Vulnerability:** Unsanitized user input (`form.author`, `form.email`, `form.body`) was output directly in `sections/article.liquid`.
**Learning:** In Shopify Liquid templates, user inputs like form variables are not auto-escaped. Outputting them dynamically back to the user inside HTML tags or attributes can lead to Reflected XSS.
**Prevention:** Always apply the `escape` filter (e.g., `{{ form.field | escape }}`) when outputting form variables dynamically back to the user to prevent Reflected XSS.
## 2024-05-25 - [Reflected XSS in Form Variables]
**Vulnerability:** Unsanitized user input (`form.author`, `form.email`, `form.body`) was being directly outputted back to the user in `sections/article.liquid`.
**Learning:** If a form submission fails and the form is re-rendered to show validation errors to the user, directly rendering the previous inputs (`value="{{ form.author }}"`) opens the application up to a reflected XSS vulnerability.
**Prevention:** Always use the `escape` filter when outputting user input dynamically back to the user inside HTML tags or attributes (e.g., `{{ form.author | escape }}`).

## 2024-05-25 - [Reflected XSS in Article Author via Localized String]
**Vulnerability:** Unsanitized variable `article.author` was passed to a Shopify translation string ending in `_html` in `sections/article.liquid` and `sections/blog.liquid`.
**Learning:** Shopify localizations with keys ending in `_html` output raw HTML directly. If unescaped variables are passed as arguments to these translations, they become vulnerable to Reflected XSS.
**Prevention:** Always use the `escape` filter on user input or dynamic properties like `article.author` before passing them as arguments to `_html` translation keys (e.g., `{% assign escaped_author = article.author | escape %}`).

## 2024-05-25 - [DOM-based XSS via innerHTML]
**Vulnerability:** Unsanitized dynamic properties (like `data.src` and `data.id`) were being interpolated directly into `<iframe>` and `<video>` tags via `innerHTML` assignment without proper HTML escaping. Using a rudimentary `.replace(/"/g, '&quot;')` is insufficient.
**Learning:** Assigning unescaped user-controlled or dynamic data to `innerHTML` can lead to DOM-based Cross-Site Scripting (XSS).
**Prevention:** Always sanitize dynamic variables using robust local escaping functions (like `escapeHTML()` that escapes `&`, `<`, `>`, `"`, and `'`) before interpolating them into HTML strings that will be parsed by `innerHTML`.
## 2025-02-28 - [DOM-based XSS in Favoritos innerHTML]
**Vulnerability:** Dynamic properties like `p.title`, `p.handle` and `p.id` returned from the Shopify API via fetch in `sections/favoritos.liquid` were interpolated into a template string and assigned to `innerHTML` without adequate sanitization.
**Learning:** Using a rudimentary string replace for quotes is insufficient and allows malicious handles/titles to execute arbitrary XSS payloads when rendered client-side via innerHTML.
**Prevention:** Always implement a dedicated HTML escaping function (e.g. `escapeHTML`) that escapes all key control characters (`&`, `<`, `>`, `"`, and `'`) before interpolating dynamic data into strings assigned to `innerHTML`.

## 2025-02-28 - [Incomplete HTML Escaping in Cart Drawer]
**Vulnerability:** The `esc()` function in `layout/theme.liquid` used for escaping dynamic cart item properties was missing escaping for single quotes (`'`).
**Learning:** While most HTML attributes were wrapped in double quotes, omitting single quote escaping could still leave the application vulnerable if the escaped string is used in a context where single quotes are significant.
**Prevention:** Always escape all HTML control characters (`&`, `<`, `>`, `"`, and `'`) when interpolating dynamic data into strings assigned to `.innerHTML` or `outerHTML`.
## 2025-02-28 - [Reflected XSS in Customer Address Form Fields]
**Vulnerability:** Unsanitized variables `address.first_name`, `address.last_name`, `address.address1`, etc., were rendered directly into the `value="{{ ... }}"` attributes of `<input>` elements in `snippets/address-form-fields.liquid`.
**Learning:** In Shopify Liquid templates, customer address variables are not automatically HTML-escaped. Outputting them unescaped in HTML attributes opens the form to Reflected XSS if malicious input containing quotes is injected.
**Prevention:** Always apply the `escape` filter (e.g., `{{ address.first_name | escape }}`) when rendering user-provided data directly into HTML attributes like `value`.

## 2025-02-28 - [Reflected XSS in Line Item Properties]
**Vulnerability:** Unsanitized user inputs in `line_item.properties` (specifically `p.first` and `p.last`) were being output directly in HTML tags without escaping in `templates/customers/order.liquid` and `snippets/cart-drawer.liquid`.
**Learning:** In Shopify Liquid templates, line item properties are user-controlled input (e.g. from cart forms or custom product pages) and are not auto-escaped. Outputting them dynamically back to the user inside HTML tags without sanitization opens the application up to Reflected XSS vulnerabilities.
**Prevention:** Always apply the `escape` filter when rendering line item properties (e.g., `{{ p.first | escape }}: {{ p.last | escape }}`) into HTML.

## 2025-02-28 - [Stored XSS in Customer and Address Variables]
**Vulnerability:** Unsanitized variables `customer.name`, `customer.email`, and address fields (`customer.default_address.street`, `address.first_name`, `address.city`, `order.shipping_address.street`, etc.) were rendered directly into HTML in `templates/customers/account.liquid`, `templates/customers/addresses.liquid`, and `templates/customers/order.liquid`.
**Learning:** In Shopify Liquid templates, customer details and address fields are not automatically HTML-escaped. Outputting them unescaped in HTML allows Stored XSS if a user enters malicious data (like `<script>alert(1)</script>`) into their name or address fields.
**Prevention:** Always apply the `escape` filter (e.g., `{{ customer.name | escape }}`) when rendering user-provided data directly into HTML.
## 2024-05-27 - [Stored XSS in Article Comments]
**Vulnerability:** User inputs from blog comments (`comment.author` and `comment.content`) were rendered directly into HTML without escaping in `sections/article.liquid`.
**Learning:** In Shopify Liquid templates, article comments are user-controlled input and can contain arbitrary HTML payloads. Outputting them dynamically back to the user without sanitization leads to Stored XSS vulnerabilities on blog posts.
**Prevention:** Always apply the `escape` filter (e.g., `{{ comment.author | escape }}`) when rendering user-submitted comments directly into HTML.
