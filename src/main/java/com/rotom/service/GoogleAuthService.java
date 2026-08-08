package com.rotom.service;

import com.google.api.client.auth.oauth2.Credential;
import com.google.api.client.googleapis.auth.oauth2.GoogleAuthorizationCodeFlow;
import com.google.api.services.gmail.Gmail;
import com.google.api.services.gmail.model.Profile;
import com.rotom.config.GmailConfig;
import org.springframework.stereotype.Service;

@Service
public class GoogleAuthService {

    private Gmail gmail;

    public boolean hasStoredCredential() {
        try {
            GoogleAuthorizationCodeFlow flow = GmailConfig.buildFlow();
            Credential credential = flow.loadCredential("user");
            return credential != null && credential.getAccessToken() != null;
        } catch (Exception e) {
            return false;
        }
    }

    public void initFromStoredCredential() throws Exception {
        GoogleAuthorizationCodeFlow flow = GmailConfig.buildFlow();
        Credential credential = flow.loadCredential("user");
        if (credential == null) throw new RuntimeException("No stored credential found.");
        this.gmail = GmailConfig.buildGmailService(credential);
    }

    public void initFromCode(String code) throws Exception {
        GoogleAuthorizationCodeFlow flow = GmailConfig.buildFlow();
        var tokenResponse = flow.newTokenRequest(code)
                .setRedirectUri(GmailConfig.REDIRECT_URI)
                .execute();
        Credential credential = flow.createAndStoreCredential(tokenResponse, "user");
        this.gmail = GmailConfig.buildGmailService(credential);
    }

    public String getAuthorizationUrl() throws Exception {
        GoogleAuthorizationCodeFlow flow = GmailConfig.buildFlow();
        return flow.newAuthorizationUrl()
                .setRedirectUri(GmailConfig.REDIRECT_URI)
                .build();
    }

    public Gmail getGmailService() {
        return gmail;
    }

    public boolean isAuthenticated() {
        if (gmail == null) return false;
        try {
            gmail.users().getProfile("me").execute();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public String getUserEmail() {
        if (gmail == null) return null;
        try {
            Profile profile = gmail.users().getProfile("me").execute();
            return profile.getEmailAddress();
        } catch (Exception e) {
            return null;
        }
    }
}
