# R.O.T.O.M.

**Remover Of Trash & Obsolete Mails**

Rotom is a Chrome extension that helps you reclaim your Gmail storage by scanning for large, old, or unwanted emails and bulk-trashing or permanently deleting them — directly from your browser, no server required.

## Features

- **Large Email Scanner** — Filter by size (1 MB → 25 MB, default 5 MB), category (Promotions, Social, Spam, Has attachment, Newsletters), age (1 month → 2 years), and sender. Results are sorted by size, 25 per page, with Load more.
- **Bulk Trash / Delete Forever** — Trash (recoverable for 30 days) or permanently delete the selected emails, with confirmation modals and live progress. Long jobs run in the service worker, so they keep going if the popup closes.
- **Empty Trash** — Permanently delete everything in Trash, with confirmation.
- **Restore from Trash** — Browse your trashed emails and restore the selected ones back to your mailbox in bulk, with live progress.
- **Unsubscribe** — Per-email and bulk unsubscribe from newsletters using the `List-Unsubscribe` header (one-click POST or mailto), with per-row status (pending / done / failed) and an option to also move the email to Trash.
- **Recoverable size indicator** — See how much space the selected emails would free before you commit.
- **Storage overview** — Total message count for your connected account.
- **Click a sender to filter** — Clicking a sender in the results re-scans for that sender.
- **Persistent filters** — Your last filters are restored when you reopen the popup.
- **Liquid-glass dark UI** — Clean, fast, 540 px wide popup.

## How it works

- Auth via `chrome.identity` + Google OAuth 2.0 (scope `https://mail.google.com/` — full Gmail access, needed to trash and delete).
- The Gmail REST API is called directly from the extension; there is no server, and no data leaves your browser except to Google's APIs.
- A scan lists message IDs, then fetches metadata in a single multipart batch request (Subject, From, Date, `List-Unsubscribe`).
- Trash, Delete Forever, Empty Trash, and Restore run as background jobs in chunks of 1,000, with progress persisted in `chrome.storage.session` so a job survives service-worker restarts.
- API calls retry with exponential backoff on rate limiting (429).
- Security: message IDs are validated before every API call, sender filters are sanitized so Gmail search operators stay literal text, HTML and CSS output is escaped, runtime messages are accepted only from the extension itself, unsubscribe URLs must be public HTTPS, and signing out revokes the OAuth token.

## Tech Stack

| Layer     | Technology                                    |
|-----------|-----------------------------------------------|
| Extension | Chrome Manifest V3                            |
| Auth      | `chrome.identity` + Google OAuth 2.0          |
| API       | Gmail REST API (called directly from the extension) |
| Frontend  | HTML, CSS, Vanilla JavaScript                 |
| Build     | esbuild (bundles `src/` into `extension/`)    |
| Tests     | Vitest                                        |
| Lint      | ESLint 9                                      |

## Project Structure

```
├── extension/            ← Load this folder in chrome://extensions (built output)
│   ├── manifest.json     ← Extension config (client_id + pinned extension key)
│   ├── popup.html        ← Popup UI
│   ├── popup.css         ← Liquid-glass dark theme
│   ├── popup.js          ← Built bundle — do not edit by hand
│   ├── background.js     ← Built bundle — do not edit by hand
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── src/                  ← Source of truth — edit here, then run npm run build
│   ├── popup.js          ← Popup UI: scan, select, trash/delete/restore/unsubscribe
│   ├── background.js     ← Service worker: background jobs + unsubscribe
│   ├── api.js            ← Gmail REST client + OAuth revocation
│   ├── utils.js          ← Formatting, escaping, query + unsubscribe parsing
│   └── *.test.js         ← Unit tests (Vitest)
├── test_batch.js         ← Scratch script for the Gmail batch API (not part of the extension)
├── package.json
├── eslint.config.mjs
└── README.md
```

## Installation (developer mode — free, no publishing needed)

1. Clone or download this repo.
2. Run `npm install` (only needed if you change `src/` and want to rebuild).
3. Open Chrome and go to `chrome://extensions/`.
4. Enable **Developer mode** (top-right toggle).
5. Click **Load unpacked** and select the `extension/` folder.

The R.O.T.O.M. icon will appear in your toolbar.

## Setup — Google Cloud OAuth

This repo already ships with an OAuth client ID and a pinned extension key in `extension/manifest.json`, so it works right after loading unpacked. If you fork the project or want your own Google Cloud project, replace them:

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. `rotom-mail-cleaner`).
3. Navigate to **APIs & Services → Library**, search for **Gmail API**, and enable it.

### 2. Configure the OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Select **External**, fill in the app name and your email.
3. Add the scope `https://mail.google.com/`.
4. Under **Test users**, add your Gmail address.

### 3. Create OAuth Credentials for a Chrome Extension

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Choose **Chrome Extension** as the application type.
3. Paste your extension's ID (found on `chrome://extensions/` after loading unpacked).
4. Copy the generated **Client ID**.

### 4. Set the Client ID in the Extension

Open `extension/manifest.json` and replace `oauth2.client_id`. If your extension ID differs from the pinned one, also update the `key` field (or remove it and let Chrome generate a new ID, then register that ID in step 3).

Reload the extension on `chrome://extensions/` after saving.

## Development

```bash
npm install   # install dev dependencies (esbuild, vitest, eslint)
npm run build # bundle src/popup.js and src/background.js into extension/
npm test      # run unit tests with Vitest
npm run lint  # lint src/ with ESLint
```

`extension/popup.js` and `extension/background.js` are built files — edit `src/` and rebuild, then commit the rebuilt bundles.

## Usage

1. Click the R.O.T.O.M. icon in your toolbar.
2. Click **Connect Gmail** and sign in with Google (you can switch accounts from the auth screen).
3. Set your filters (size, category, age, sender).
4. Click **Scan**.
5. Select emails and click **Trash**, **Delete**, or **Unsubscribe** (bulk unsubscribe only includes senders that support it). Click a sender's name to re-scan for that sender. Click **🗑 Trash** to browse your trashed emails and **Restore** the ones you want back.
6. Use **Empty Trash** to permanently delete everything in Trash.

> Trashed emails can be recovered from Gmail's Trash within 30 days — or right from Rotom's Trash view with **Restore**. **Delete Forever** and **Empty Trash** cannot be undone.

## Cost

| Action                        | Cost                        |
|-------------------------------|-----------------------------|
| Development & local testing   | Free                        |
| Publishing to Chrome Web Store| **$5 USD one-time** (developer registration) |

The extension is not published to the Chrome Web Store yet.

## License

[MIT](LICENSE)
