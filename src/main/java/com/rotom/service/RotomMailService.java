package com.rotom.service;

import com.google.api.services.gmail.Gmail;
import com.google.api.services.gmail.model.ListMessagesResponse;
import com.google.api.services.gmail.model.Message;
import com.google.api.services.gmail.model.MessagePartHeader;
import com.google.api.services.gmail.model.Profile;
import com.rotom.dto.EmailItem;
import com.rotom.dto.TrashResponse;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class RotomMailService {

    private final GoogleAuthService googleAuthService;

    public RotomMailService(GoogleAuthService googleAuthService) {
        this.googleAuthService = googleAuthService;
    }

    public List<EmailItem> findLargeEmails(int minSizeMB) {
        try {
            Gmail gmail = googleAuthService.getGmailService();
            String query = "larger:" + minSizeMB + "M";

            ListMessagesResponse response = gmail.users().messages()
                    .list("me")
                    .setQ(query)
                    .setMaxResults(50L)
                    .execute();

            List<Message> messages = response.getMessages();
            if (messages == null || messages.isEmpty()) {
                return new ArrayList<>();
            }

            List<EmailItem> emailItems = new ArrayList<>();

            for (Message msgRef : messages) {
                Message msg = gmail.users().messages()
                        .get("me", msgRef.getId())
                        .setFormat("metadata")
                        .setMetadataHeaders(Arrays.asList("Subject", "From", "Date"))
                        .execute();

                String subject = "";
                String from = "";
                String date = "";

                if (msg.getPayload() != null && msg.getPayload().getHeaders() != null) {
                    for (MessagePartHeader header : msg.getPayload().getHeaders()) {
                        switch (header.getName()) {
                            case "Subject":
                                subject = header.getValue();
                                break;
                            case "From":
                                from = header.getValue();
                                break;
                            case "Date":
                                date = header.getValue();
                                break;
                        }
                    }
                }

                long estimatedSize = msg.getSizeEstimate() != null ? msg.getSizeEstimate().longValue() : 0L;
                String readableSize = EmailItem.formatSize(estimatedSize);
                String snippet = msg.getSnippet() != null ? msg.getSnippet() : "";

                EmailItem item = new EmailItem(
                        msg.getId(),
                        subject,
                        from,
                        date,
                        snippet,
                        estimatedSize,
                        readableSize
                );

                emailItems.add(item);
            }

            emailItems.sort(Comparator.comparingLong(EmailItem::getEstimatedSize).reversed());

            return emailItems;
        } catch (Exception e) {
            throw new RuntimeException("Failed to find large emails: " + e.getMessage(), e);
        }
    }

    public TrashResponse trashEmails(List<String> messageIds) {
        Gmail gmail = googleAuthService.getGmailService();
        int trashedCount = 0;
        int failedCount = 0;

        for (String id : messageIds) {
            try {
                gmail.users().messages().trash("me", id).execute();
                trashedCount++;
            } catch (Exception e) {
                failedCount++;
            }
        }

        String message = String.format("Successfully trashed %d email(s). %d failed.",
                trashedCount, failedCount);

        return new TrashResponse(trashedCount, failedCount, message);
    }

    public Map<String, Object> getStorageInfo() {
        try {
            Gmail gmail = googleAuthService.getGmailService();
            Profile profile = gmail.users().getProfile("me").execute();

            Map<String, Object> storageInfo = new HashMap<>();
            storageInfo.put("emailAddress", profile.getEmailAddress());
            storageInfo.put("totalMessages", profile.getMessagesTotal());

            return storageInfo;
        } catch (Exception e) {
            throw new RuntimeException("Failed to retrieve storage info: " + e.getMessage(), e);
        }
    }
}
