package com.rotom.controller;

import com.rotom.service.GoogleAuthService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/setup")
public class SetupController {

    private final GoogleAuthService googleAuthService;

    public SetupController(GoogleAuthService googleAuthService) {
        this.googleAuthService = googleAuthService;
    }

    @GetMapping("/status")
    public Map<String, Object> getSetupStatus() {
        Map<String, Object> status = new HashMap<>();
        boolean credentialsExist = new File("credentials.json").exists();
        // Token is saved by Google's client library as tokens/StoredCredential
        boolean tokenExists = new File("tokens/StoredCredential").exists();

        status.put("credentialsConfigured", credentialsExist);
        // Only report authenticated if both files exist on disk — no OAuth trigger here
        status.put("authenticated", credentialsExist && tokenExists);
        status.put("email", null); // email is resolved only after explicit connect
        return status;
    }

    @PostMapping("/credentials")
    public ResponseEntity<?> uploadCredentials(@RequestParam("file") MultipartFile file) {
        try {
            if (file.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "File is empty"));
            }
            if (!file.getOriginalFilename().endsWith(".json")) {
                return ResponseEntity.badRequest().body(Map.of("error", "File must be a .json file"));
            }

            // Basic validation: must contain client_id
            String content = new String(file.getBytes());
            if (!content.contains("client_id") || !content.contains("client_secret")) {
                return ResponseEntity.badRequest().body(Map.of("error", "Invalid credentials file. Make sure you downloaded the OAuth 2.0 Client ID JSON from Google Cloud Console."));
            }

            Files.copy(file.getInputStream(), new File("credentials.json").toPath(), StandardCopyOption.REPLACE_EXISTING);
            return ResponseEntity.ok(Map.of("message", "credentials.json saved successfully"));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", "Failed to save credentials: " + e.getMessage()));
        }
    }

    @PostMapping("/connect")
    public ResponseEntity<?> connectGmail() {
        try {
            // This triggers the lazy Gmail bean.
            // If tokens/StoredCredential already exists, Google's library uses it silently (no browser).
            // If not, it opens the browser for OAuth consent.
            String email = googleAuthService.getUserEmail();
            if (email != null) {
                return ResponseEntity.ok(Map.of("success", true, "email", email));
            }
            return ResponseEntity.status(500).body(Map.of("error", "Authentication failed. Could not retrieve email."));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }
}
