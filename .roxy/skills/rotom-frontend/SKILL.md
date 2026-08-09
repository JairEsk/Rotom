---
name: rotom-frontend
description: Frontend conventions, color palette, and UI patterns for the Rotom web dashboard
---
# Rotom Frontend Conventions

## Brand Palette
```css
--bg-primary:    #1E1E1E  /* Negro Grafito — page background */
--bg-secondary:  #2C313C  /* Grafito medio — cards, panels */
--bg-surface:    #353b47  /* Grafito claro — inputs, table rows */
--accent:        #FF6B00  /* Naranja Plasma — primary buttons, highlights */
--accent-hover:  #F87030  /* Naranja hover */
--secondary:     #00A3FF  /* Azul Eléctrico — secondary actions, links */
--secondary-hover:#29E2FF /* Azul hover */
--text:          #e0e0e0  /* Body text */
--text-heading:  #FFFFFF  /* Headings */
--text-muted:    #9aa0ad  /* Hints, labels */
--border:        #444c5a  /* Borders, dividers */
--success:       #2ecc71
--error:         #e74c3c
```

## File Locations
- HTML: `src/main/resources/static/index.html`
- CSS:  `src/main/resources/static/css/styles.css`
- JS:   `src/main/resources/static/js/app.js`
- No build step — Spring Boot serves directly

## JS Conventions
- All API calls use `fetch()` with async/await
- Always `escapeHtml()` before injecting user data into DOM
- Toast notifications via `showToast(message, isError)`
- Section visibility via `showSection('loading'|'results'|'empty'|'error')`
- `emails[]` is the in-memory state; `selectedIds` is a `Set`

## API Endpoints (frontend → backend)
```
GET  /api/setup/status          → { credentialsConfigured, tokenExists, authenticated, email }
POST /api/setup/credentials     → multipart file upload of credentials.json
GET  /api/setup/auth-url        → { url } — Google OAuth URL to redirect to
GET  /oauth2callback?code=...   → handled by backend, redirects to /?oauth_success=true
GET  /api/emails?size=10        → EmailItem[]
POST /api/emails/trash          → { ids: [...] } → TrashResponse
GET  /api/storage               → { emailAddress, totalMessages }
```

## UI Principles (for this demo/debug phase)
- Functionality over design — keep it simple
- No frameworks — vanilla JS only (future: may become browser extension)
- Dark theme always — user will be staring at this for cleanup sessions
- Feedback on every action — loading states, toasts, error messages
- Safe defaults — never permanently delete, always trash first

## Adding a New UI Section
1. Add HTML section with `style="display:none"` and an id
2. Add it to `showSection()` switch in app.js
3. Call `showSection('your-section')` when needed
4. Style using existing CSS variables — no hardcoded colors
