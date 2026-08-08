package com.rotom.service;

import com.google.api.services.gmail.Gmail;
import com.google.api.services.gmail.model.Profile;
import org.springframework.stereotype.Service;

@Service
public class GoogleAuthService {

    private final Gmail gmail;

    public GoogleAuthService(Gmail gmail) {
        this.gmail = gmail;
    }

    public Gmail getGmailService() {
        return gmail;
    }

    public boolean isAuthenticated() {
        return gmail != null;
    }

    public String getUserEmail() {
        try {
            Profile profile = gmail.users().getProfile("me").execute();
            return profile.getEmailAddress();
        } catch (Exception e) {
            throw new RuntimeException("Failed to retrieve user email: " + e.getMessage(), e);
        }
    }
}
