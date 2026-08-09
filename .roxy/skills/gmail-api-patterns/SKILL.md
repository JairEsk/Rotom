---
name: gmail-api-patterns
description: Reusable Gmail API patterns for Rotom: queries, batch operations, pagination, token refresh
---
# Gmail API Patterns for Rotom

## Fetching Messages
```java
// List message IDs matching a query (max 500 per page)
ListMessagesResponse response = gmail.users().messages()
    .list("me")
    .setQ("larger:5M")
    .setMaxResults(50L)
    .setPageToken(pageToken) // null for first page
    .execute();

List<Message> messages = response.getMessages(); // only id + threadId
String nextPageToken = response.getNextPageToken(); // null if last page
```

## Fetching Message Details
```java
// METADATA format — fast, only headers + size (no body download)
Message msg = gmail.users().messages()
    .get("me", messageId)
    .setFormat("metadata")
    .setMetadataHeaders(Arrays.asList("Subject", "From", "Date"))
    .execute();

// Extract a specific header
String subject = msg.getPayload().getHeaders().stream()
    .filter(h -> "Subject".equalsIgnoreCase(h.getName()))
    .map(MessagePartHeader::getValue)
    .findFirst().orElse("(no subject)");

long sizeBytes = msg.getSizeEstimate(); // approximate size in bytes
```

## Batch Trash (safe delete)
```java
// Trash one message (recoverable from Gmail Trash within 30 days)
gmail.users().messages().trash("me", messageId).execute();

// Permanent delete (use with extreme caution)
gmail.users().messages().delete("me", messageId).execute();
```

## Batch Modify (labels)
```java
BatchModifyMessagesRequest req = new BatchModifyMessagesRequest()
    .setIds(messageIds)
    .setAddLabelIds(Arrays.asList("UNREAD"))
    .setRemoveLabelIds(Arrays.asList("INBOX"));
gmail.users().messages().batchModify("me", req).execute();
```

## User Profile & Quota
```java
Profile profile = gmail.users().getProfile("me").execute();
profile.getEmailAddress();   // "user@gmail.com"
profile.getMessagesTotal();  // total message count
profile.getThreadsTotal();
// Note: Gmail API does NOT expose storage quota — use Google Drive API for that
```

## Pagination Pattern
```java
List<EmailItem> results = new ArrayList<>();
String pageToken = null;
do {
    ListMessagesResponse page = gmail.users().messages()
        .list("me").setQ(query).setMaxResults(100L).setPageToken(pageToken).execute();
    if (page.getMessages() == null) break;
    for (Message m : page.getMessages()) {
        // fetch metadata per message
        results.add(buildEmailItem(gmail, m.getId()));
    }
    pageToken = page.getNextPageToken();
} while (pageToken != null && results.size() < MAX_RESULTS);
```

## Token Refresh
The Google API client library handles token refresh automatically when using
`GoogleAuthorizationCodeFlow` + stored credentials. No manual refresh needed
as long as `setAccessType("offline")` was set during the flow.

If refresh fails (revoked access), `gmail.users().getProfile("me").execute()`
throws a `TokenResponseException` — catch it and redirect to OAuth flow.

## Common Query Strings
| Goal | Query |
|------|-------|
| Large emails | `larger:10M` |
| From domain | `from:@amazon.com` |
| Has attachment | `has:attachment larger:5M` |
| Older than 1 year | `older_than:1y` |
| Newsletter/unsubscribe | `unsubscribe` |
| Promotions tab | `category:promotions` |
| Social tab | `category:social` |
| Spam | `in:spam` |
| Specific sender | `from:noreply@linkedin.com` |
