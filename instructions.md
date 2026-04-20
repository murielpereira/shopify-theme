name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics.
Use the information in https://shopify.dev/docs/storefronts/themes/getting-started/create to understand and create functions to a Shopify website.
Create and use Desing Tokens to assure consistency in the theme.
Do a mobile-first approach to development.
Insert all visual styles in assets/css/style.css.

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Design System Strategy: The Curated Silhouette
1. Overview & Creative North Star
The objective is to transcend the "pet store" category and enter the realm of the "Digital Flagship." This design system is built upon the Creative North Star of "Aerodynamic Elegance."
Inspired by the precision of Ferrari and the bespoke craftsmanship of Bugatti, this system treats digital space as a physical gallery. We move away from the rigid, boxed-in layouts of standard e-commerce. Instead, we utilize intentional asymmetry, generous "white space" (utilizing our cream and pearl tones), and high-contrast typography scales. The layout should feel like a high-end fashion editorial: breathing, fluid, and expensive. Every element must feel like it was placed by a curator, not a developer.
2. Colors & Surface Philosophy
The palette moves beyond simple pastels into a sophisticated range of "Warm Metallics" and "Organic Neutrals."
The "No-Line" Rule
To maintain a premium, seamless aesthetic, 1px solid borders are strictly prohibited for defining sections or containers. Visual boundaries must be created through:
Background Shifts: Transitioning from `surface` (#fff8f3) to `surface_container_low` (#fef2e5).
Tonal Nesting: A `surface_container_highest` (#ece1d5) element sitting inside a `surface_container` (#f8ece0) section.
Negative Space: Using the spacing scale to create psychological boundaries rather than physical ones.
The Glass & Gradient Rule
To evoke the precision of luxury automotive glass and paint:
Glassmorphism: Use `surface` colors at 70-80% opacity with a `20px` to `40px` backdrop-blur for floating navigation or quick-view modals.
Signature Gradients: For primary CTAs and hero highlights, use a subtle linear gradient from `primary` (#5a4742) to `primary_container` (#735e59) at a 135-degree angle. This adds a "metallic" depth that flat color cannot replicate.
3. Typography
The typography is the architecture of this system. We use Lexend as our sole structural typeface, relying on extreme scale and weight shifts to create an editorial rhythm.
Display-lg (3.5rem): Used for "Hero Moments." These should be tracked slightly tighter (-2%) to feel like a high-end logo.
Headline-md (1.75rem): Reserved for product category names and storytelling headers.
Body-lg (1rem): Used for descriptive copy. Set with a generous line-height (1.6) to ensure the text feels "airy."
Label-sm (0.6875rem): Used for metadata (e.g., "LIMITED EDITION"). Always uppercase with increased letter spacing (+10%) to mimic the branding on high-end luxury goods.
4. Elevation & Depth
In this system, depth is "baked in" rather than "stuck on." We use Tonal Layering to convey hierarchy.
The Layering Principle: Treat the UI as layers of fine vellum. A card does not sit "on top" of a page; it is a "lifted" part of the page. Use `surface_container_lowest` (#ffffff) for the most interactive elements to make them appear closest to the user.
Ambient Shadows: If a shadow is required for a floating action button, it must use the `on_surface` color at 5% opacity with a `32px` blur and `16px` Y-offset. It should look like an object floating in natural sunlight, not a digital drop shadow.
Ghost Border Fallback: For input fields or secondary buttons, use the `outline_variant` (#d2c3c0) at 15% opacity. This creates a "suggestion" of a border that guides the eye without cluttering the interface.
5. Components
Buttons
Primary: Solid `primary` (#5a4742) with `on_primary` text. No border. Corners use the `md` (0.375rem) roundedness to feel modern but structured.
Secondary: No background. `primary` text color. A subtle `surface_variant` hover state that fades in over 300ms.
Interactions: On hover, buttons should subtly scale (1.02x) rather than just changing color, mimicking the tactile feedback of a luxury car’s haptic controls.
Chips (Product Tags)
Luxury Style: Chips should use `surface_container_high` backgrounds with `on_surface_variant` text. Avoid heavy colors; the product image should always be the hero.
Cards & Product Showcase
The "No-Divider" Rule: Vertical white space is your divider. Use a `surface_container` background for the entire card to separate it from the `surface` background of the page.
Imagery: Product photos must be high-key, shot on neutral backgrounds that match our `E8E3DF` (tertiary_fixed) or `FFFFFF` tones.
Input Fields
Refined Entry: Use a "minimalist tray" style. No full-box outline. Only a 1px `outline_variant` at the bottom of the field. Upon focus, the bottom line transitions to `primary` and the label slides up using a "Display-sm" scale transition.
Custom Component: The "Lookbook" Carousel
Instead of standard arrows, use large, low-opacity hit areas on the left and right. The transition between items must be a "long-duration" slide (800ms) with a custom cubic-bezier (0.22, 1, 0.36, 1) to mimic the smooth glide of a Bugatti.
6. Do's and Don'ts
Do
DO use extreme vertical margins (e.g., 120px between sections) to create an "expensive" feel.
DO overlay text on images using the "Glassmorphism" rule to integrate content with product photography.
DO use `primary_fixed_dim` (#dcc1ba) for subtle background accents to keep the "soft pink" brand essence alive.
Don't
DON'T use 100% black (#000000). Always use `on_background` (#201b14) for text to maintain a soft, premium feel.
DON'T use sharp 90-degree corners. The "luxury" feel comes from the `DEFAULT` (0.25rem) and `md` (0.375rem) radiuses which feel "machined" and intentional.
DON'T use standard "busy" loaders. Use a custom, slow-pulsing logo mark or a single, elegant line that moves across the top of the screen.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.