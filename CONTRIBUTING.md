# Contributing

## Ground rules

- **No runtime dependencies.** The app runs on Node's built-ins (`http`, `sqlite`, `crypto`). Build-time tools (Docker, Bubblewrap) are fine.
- **All state changes go through `src/lib/services.js`**, so the web UI and USSD behave the same.
- **Schema changes are new files** in `src/migrations/` (`NNN_description.sql`). Never edit a migration that has shipped.
- **Every user-facing string goes in `src/i18n/en.js`.** The other languages fall back to English until a native speaker translates.
- **Emoji must render on Android 7+.** Nothing newer than Unicode 11.
- **UI uses the design system.** Styles live in `src/views/app.css` (tokens at the top, light and dark). Reuse the helpers in `src/views/ui.js` (`sectionHead`, `emptyState`, `metaList`, `stat`, `ring`, `avatar`, `progress`, `backLink`) and the SVG icons in `src/views/icons.js` (`icon('name')`). Emoji are for content (skills, courses), icons are for the app chrome. No inline scripts; behaviour goes in the progressive-enhancement script in `src/routes/static.js`, and every page must still work without JavaScript.

## Workflow

```bash
npm run seed && npm run dev    # http://localhost:3000, PIN 1234 for demo users
npm test                       # must pass; CI runs it on Node 22 and 24 and inside the Docker build
```

1. Branch from `main`.
2. Add or adjust tests with your change.
3. Open a pull request using the template. CI must be green before merge.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.
