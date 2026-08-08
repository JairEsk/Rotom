package com.rotom.service;

import com.google.api.services.gmail.Gmail;
import com.google.api.services.gmail.model.Profile;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

@Service
public class GoogleAuthService {

    private final Gmail gmail;

    public GoogleAuthService(@Lazy Gmail gmail) {
        this.gmail = gmail;
    }

    public Gmail getGmailService() {
        return gmail;
    }

    public boolean isAuthenticated() {
        try {
            gmail.users().getProfile("me").execute();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public String getUserEmail() {
        try {
            Profile profile = gmail.users().getProfile("me").execute();
            return profile.getEmailAddress();
        } catch (Exception e) {
            return null;
        }
    }
}
