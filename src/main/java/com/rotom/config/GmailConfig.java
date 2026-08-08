package com.rotom.config;

import com.google.api.client.auth.oauth2.Credential;
import com.google.api.client.extensions.java6.auth.oauth2.AuthorizationCodeInstalledApp;
import com.google.api.client.extensions.jetty.auth.oauth2.LocalServerReceiver;
import com.google.api.client.googleapis.auth.oauth2.GoogleAuthorizationCodeFlow;
import com.google.api.client.googleapis.auth.oauth2.GoogleClientSecrets;
import com.google.api.client.googleapis.javanet.GoogleNetHttpTransport;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.client.util.store.FileDataStoreFactory;
import com.google.api.services.gmail.Gmail;
import com.google.api.services.gmail.GmailScopes;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.util.Collections;
import java.util.List;

@Configuration
public class GmailConfig {

    private static final String APPLICATION_NAME = "Rotom";
    private static final String TOKENS_DIRECTORY = "tokens";
    private static final List<String> SCOPES = Collections.singletonList(GmailScopes.GMAIL_MODIFY);

    @Bean
    @Lazy
    public Gmail gmailService() {
        try {
            File credentialsFile = new File("credentials.json");
            if (!credentialsFile.exists()) {
                throw new RuntimeException(
                        "credentials.json not found in the project root. " +
                        "Please download it from the Google Cloud Console " +
                        "(APIs & Services > Credentials > OAuth 2.0 Client ID) " +
                        "and place it in the project root directory."
                );
            }

            final NetHttpTransport httpTransport = GoogleNetHttpTransport.newTrustedTransport();
            final GsonFactory jsonFactory = GsonFactory.getDefaultInstance();

            GoogleClientSecrets clientSecrets = GoogleClientSecrets.load(
                    jsonFactory,
                    new InputStreamReader(new FileInputStream(credentialsFile))
            );

            GoogleAuthorizationCodeFlow flow = new GoogleAuthorizationCodeFlow.Builder(
                    httpTransport, jsonFactory, clientSecrets, SCOPES)
                    .setDataStoreFactory(new FileDataStoreFactory(new File(TOKENS_DIRECTORY)))
                    .setAccessType("offline")
                    .build();

            LocalServerReceiver receiver = new LocalServerReceiver.Builder()
                    .setPort(8888)
                    .build();

            Credential credential = new AuthorizationCodeInstalledApp(flow, receiver).authorize("user");

            return new Gmail.Builder(httpTransport, jsonFactory, credential)
                    .setApplicationName(APPLICATION_NAME)
                    .build();
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Failed to initialize Gmail service: " + e.getMessage(), e);
        }
    }
}
