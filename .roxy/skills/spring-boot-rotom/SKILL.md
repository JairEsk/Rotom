---
name: spring-boot-rotom
description: Workflow for adding features, fixing bugs, and running the Rotom Spring Boot + Gmail API project
---
# Rotom — Spring Boot Development Workflow

## Project Context
- **Stack:** Java 17, Spring Boot 3.2, Maven Wrapper, Vanilla HTML/CSS/JS
- **Location:** `F:\rotom`
- **Java 17 path:** `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot`
- **Run server:** `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot"; $env:Path = "$env:JAVA_HOME\bin;$env:Path"; .\mvnw.cmd spring-boot:run`
- **Kill port 8080:** `netstat -ano | findstr :8080 | findstr LISTENING` then `taskkill /PID <pid> /F`
- **Shell:** PowerShell on Windows — use `;` not `&&` to chain commands

## Package Structure
```
com.rotom/
  config/       GmailConfig.java (OAuth flow builder, static helpers)
  controller/   EmailController.java, SetupController.java
  service/      GoogleAuthService.java (holds Gmail instance), RotomMailService.java
  dto/          EmailItem.java, TrashRequest.java, TrashResponse.java
```

## Key Design Rules
- `GoogleAuthService.gmail` is an in-memory instance — initialized on OAuth callback or from stored token
- `credentials.json` lives at project root (never committed)
- Tokens stored in `tokens/StoredCredential` (never committed)
- Gmail bean is NOT a Spring bean anymore — `GmailConfig` has static helpers only
- OAuth redirect URI is hardcoded: `http://localhost:8080/oauth2callback`
- Always use `@Lazy` if injecting Gmail-dependent beans to avoid startup crashes

## Adding a New Feature Checklist
1. Add method to `RotomMailService` (Gmail logic)
2. Add endpoint to `EmailController` (REST)
3. Update `app.js` (fetch call + UI)
4. Test via browser at `http://localhost:8080`
5. `git add -A && git commit -m "feat: ..."` then `git push origin main`

## Gmail API Query Reference
- Large emails: `larger:10M`
- From sender: `from:example@gmail.com`
- Has attachment: `has:attachment`
- Older than: `older_than:1y`
- In inbox: `in:inbox`
- Unread: `is:unread`

## Common Pitfalls
- Port 8080 stays occupied if server isn't killed properly — always `taskkill` before restarting
- `tokens/StoredCredential` corruption causes silent blank page — delete `tokens/` folder to reset auth
- `credentials.json` type must be `"web"` not `"installed"` — the flow uses HTTP redirect, not LocalServerReceiver
- `isAuthenticated()` makes a live Gmail API call — don't call it on every request
- Spring Boot serves static files from `src/main/resources/static/` — no build step needed for frontend

## Git Commit Convention
- `feat:` new feature
- `fix:` bug fix
- `style:` CSS/UI only
- `refactor:` code restructure, no behavior change
- `docs:` README or comments
