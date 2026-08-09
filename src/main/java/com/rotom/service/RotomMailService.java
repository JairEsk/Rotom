package com.rotom.service;

import com.google.api.services.gmail.Gmail;
import com.google.api.services.gmail.model.ListMessagesResponse;
import com.google.api.services.gmail.model.Message;
import com.google.api.services.gmail.model.MessagePartHeader;
import com.google.api.services.gmail.model.Profile;
import com.rotom.dto.DeleteResponse;
import com.rotom.dto.EmailItem;
import com.rotom.dto.EmailPage;
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

    public EmailPage findEmails(String query, String pageToken) {
        try {
            Gmail gmail = googleAuthService.getGmailService();

            var listRequest = gmail.users().messages()
                    .list("me")
                    .setQ(query)
                    .setMaxResults(25L);

            if (pageToken != null && !pageToken.isBlank()) {
                listRequest.setPageToken(pageToken);
            }

            ListMessagesResponse response = listRequest.execute();
            List<Message> messages = response.getMessages();

            if (messages == null || messages.isEmpty()) {
                return new EmailPage(new ArrayList<>(), null);
            }

            List<EmailItem> emailItems = new ArrayList<>();
            for (Message msgRef : messages) {
                emailItems.add(fetchEmailItem(gmail, msgRef.getId()));
            }

            emailItems.sort(Comparator.comparingLong(EmailItem::getEstimatedSize).reversed());
            return new EmailPage(emailItems, response.getNextPageToken());
        } catch (Exception e) {
            throw new RuntimeException("Failed to find emails: " + e.getMessage(), e);
        }
    }

    private EmailItem fetchEmailItem(Gmail gmail, String messageId) throws Exception {
        Message msg = gmail.users().messages()
                .get("me", messageId)
                .setFormat("metadata")
                .setMetadataHeaders(Arrays.asList("Subject", "From", "Date"))
                .execute();

        String subject = "", from = "", date = "";
        if (msg.getPayload() != null && msg.getPayload().getHeaders() != null) {
            for (MessagePartHeader h : msg.getPayload().getHeaders()) {
                switch (h.getName()) {
                    case "Subject" -> subject = h.getValue();
                    case "From"    -> from    = h.getValue();
                    case "Date"    -> date    = h.getValue();
                }
            }
        }

        long size = msg.getSizeEstimate() != null ? msg.getSizeEstimate().longValue() : 0L;
        return new EmailItem(msg.getId(), subject, from, date,
                msg.getSnippet() != null ? msg.getSnippet() : "",
                size, EmailItem.formatSize(size));
    }

    // Keep old method as a convenience wrapper for backward compat
    public EmailPage findLargeEmails(int minSizeMB, String pageToken) {
        return findEmails("larger:" + minSizeMB + "M", pageToken);
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

    public DeleteResponse deleteEmailsPermanently(List<String> messageIds) {
        Gmail gmail = googleAuthService.getGmailService();
        int deleted = 0, failed = 0;
        for (String id : messageIds) {
            try {
                gmail.users().messages().delete("me", id).execute();
                deleted++;
            } catch (Exception e) {
                failed++;
            }
        }
        return new DeleteResponse(deleted, failed,
                String.format("Permanently deleted %d email(s). %d failed.", deleted, failed));
    }

    // Returns the IDs that are confirmed in TRASH label
    public List<String> verifyTrashed(List<String> messageIds) {
        Gmail gmail = googleAuthService.getGmailService();
        List<String> confirmed = new ArrayList<>();
        for (String id : messageIds) {
            try {
                Message msg = gmail.users().messages()
                        .get("me", id).setFormat("minimal").execute();
                if (msg.getLabelIds() != null && msg.getLabelIds().contains("TRASH")) {
                    confirmed.add(id);
                }
            } catch (Exception ignored) {}
        }
        return confirmed;
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
