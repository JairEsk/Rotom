# R.O.T.O.M.

**Remover Of Trash & Obsolete Mails**

Rotom is a Chrome extension that helps you reclaim your Gmail storage by scanning for large, old, or unwanted emails and bulk-trashing or permanently deleting them — directly from your browser, no server required.

## Features

- **Large Email Scanner** — Filter emails by size (1 MB → 25 MB), category, age, and sender
- **Bulk Trash / Delete Forever** — Act on dozens of emails in one click
- **Recoverable size indicator** — See how much space you'd free before you commit
- **Storage overview** — Total message count for your connected account
- **Dark-themed popup** — Clean, fast, 540 px wide popup UI

## Tech Stack

| Layer     | Technology                                    |
|-----------|-----------------------------------------------|
| Extension | Chrome Manifest V3                            |
| Auth      | `chrome.identity` + Google OAuth 2.0          |
| API       | Gmail REST API (called directly from popup)   |
| Frontend  | HTML, CSS, Vanilla JavaScript                 |

## Installation (developer mode — free, no publishing needed)

1. Clone or download this repo.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `extension/` folder.

The R.O.T.O.M. icon will appear in your toolbar.

## Setup — Google Cloud OAuth

Because the extension calls the Gmail API on your behalf, you need a Google Cloud OAuth client ID.

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

Open `extension/manifest.json` and replace the placeholder:

```json
"oauth2": {
  "client_id": "YOUR_CHROME_OAUTH_CLIENT_ID.apps.googleusercontent.com",
  ...
}
```

Reload the extension on `chrome://extensions/` after saving.

## Usage

1. Click the R.O.T.O.M. icon in your toolbar.
2. Click **Connect Gmail** and sign in with Google.
3. Set your filters (size, category, age, sender).
4. Click **Scan**.
5. Select emails and click **Trash** or **Delete Forever**.

> Trashed emails can be recovered from Gmail's Trash within 30 days.

## Project Structure

```
extension/
├── manifest.json       ← Extension config (set your client_id here)
├── popup.html          ← Popup UI
├── popup.css           ← Dark-theme styles
├── popup.js            ← All app logic + Gmail API calls
├── background.js       ← Service worker (minimal)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Cost

| Action                        | Cost                        |
|-------------------------------|-----------------------------|
| Development & local testing   | Free                        |
| Publishing to Chrome Web Store| **$5 USD one-time** (developer registration) |

## License

[MIT](LICENSE)
