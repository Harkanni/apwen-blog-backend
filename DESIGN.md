# DESIGN.md

The design system for the APWEN blog lives with the UI, in the frontend repo: `apwen-blog-frontend/DESIGN.md`.

What matters on this side:

- **Error messages are UI.** The studio shows `error` strings to a non-technical editor verbatim. Write them in plain, active sentences that say what happened and what to do ("That image is larger than 8 MB. Try a smaller one."), never stack traces or codes.
- **Content is design data.** Stories are Tiptap JSON so the frontend controls every pixel. Keep `src/lib/content.js` in step with the editor's blocks: image `layout` (normal/wide/full), callout `variant` (info/tip/warning/success), pull quote `cite`, highlight and text colours.
- **Images carry dimensions** (`width`/`height` from `src/lib/image.js`) so pages can reserve space and avoid layout shift on slow mobile connections.
