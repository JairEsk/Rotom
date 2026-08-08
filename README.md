# R.O.T.O.M.

**Remover Of Trash & Obsolete Mails**

Rotom is a smart email management tool that helps you reclaim your Gmail storage by finding and removing large, unnecessary emails. Run it locally, scan your inbox, and trash the emails that are eating up your space — all from a clean web dashboard.

## Features

- **Large Email Scanner** — Find emails above a configurable size threshold (1 MB, 5 MB, 10 MB, 25 MB, etc.)
- **Bulk Trash** — Select multiple emails and send them to Gmail's Trash in one click
- **Safe Deletion** — Emails are moved to Trash (not permanently deleted), so you can recover them within 30 days
- **Storage Overview** — See your connected account and total message count
- **Dark-Themed Dashboard** — A clean, modern interface to manage your inbox

### Planned Features

- Automated retention policies (auto-delete emails older than X days)
- Spam and newsletter subscription management
- Smart tagging and categorization

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Backend  | Java 17, Spring Boot 3.2            |
| Frontend | HTML, CSS, Vanilla JavaScript       |
| API      | Gmail API via Google OAuth 2.0      |
| Build    | Maven (wrapper included)            |

## Prerequisites

- **Java 17+** — [Download from Adoptium](https://adoptium.net/)
- **A Google Account** with Gmail
- **Google Cloud Project** with Gmail API enabled (see setup below)

## Setup

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (e.g., `rotom-mail-cleaner`)
3. Navigate to **APIs & Services > Library**
4. Search for **Gmail API** and enable it

### 2. Configure OAuth Consent Screen

1. Go to **APIs & Services > OAuth consent screen**
2. Select **External** user type
3. Fill in the app name and your email
4. Add the scope: `https://www.googleapis.com/auth/gmail.modify`
5. Under **Test users**, add your Gmail address

### 3. Create OAuth Credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. Choose **Desktop app** as the application type
4. Download the JSON file
5. **Rename it to `credentials.json`** and place it in the project root directory

> **Important:** Never commit `credentials.json` to version control. It is already in `.gitignore`.

### 4. Clone and Run

```bash
# Clone the repository
git clone https://github.com/JairEsk/Rotom.git
cd Rotom

# Place your credentials.json in this directory

# Run with Maven Wrapper (no Maven installation needed)
# Linux / macOS:
./mvnw spring-boot:run

# Windows:
mvnw.cmd spring-boot:run
```

On first run, a browser window will open asking you to sign in with your Google account and grant Rotom access to your Gmail. After authorization, a token is saved locally in the `tokens/` directory so you won't need to sign in again.

### 5. Open the Dashboard

Navigate to **http://localhost:8080** in your browser.

## Usage

1. **Select a size filter** from the dropdown (e.g., "5 MB")
2. Click **Scan Inbox** to find all emails larger than the selected size
3. **Review** the results — see sender, subject, date, and size for each email
4. **Select** the emails you want to remove (or use "Select All")
5. Click **Trash Selected** — emails will be moved to Gmail's Trash folder

> Trashed emails can be recovered from Gmail's Trash within 30 days.

## Project Structure

```
rotom/
├── src/
│   └── main/
│       ├── java/com/rotom/
│       │   ├── RotomApplication.java          # Spring Boot entry point
│       │   ├── config/
│       │   │   ├── GmailConfig.java           # Gmail API & OAuth setup
│       │   │   └── WebConfig.java             # CORS configuration
│       │   ├── controller/
│       │   │   └── EmailController.java       # REST API endpoints
│       │   ├── dto/
│       │   │   ├── EmailItem.java             # Email data model
│       │   │   ├── TrashRequest.java           # Trash request payload
│       │   │   └── TrashResponse.java          # Trash response payload
│       │   └── service/
│       │       ├── GoogleAuthService.java      # Auth wrapper
│       │       └── RotomMailService.java       # Gmail operations
│       └── resources/
│           ├── application.properties
│           └── static/
│               ├── index.html                  # Dashboard
│               ├── css/styles.css              # Dark theme styles
│               └── js/app.js                   # Frontend logic
├── pom.xml
├── credentials.json                            # YOUR file (not committed)
└── tokens/                                     # Auto-generated (not committed)
```

## API Endpoints

| Method | Endpoint             | Description                        |
|--------|----------------------|------------------------------------|
| GET    | `/api/auth/status`   | Check authentication status        |
| GET    | `/api/emails?size=5` | Find emails larger than 5 MB       |
| POST   | `/api/emails/trash`  | Trash selected emails (send IDs)   |
| GET    | `/api/storage`       | Get account storage info           |

## License

[MIT](LICENSE)
