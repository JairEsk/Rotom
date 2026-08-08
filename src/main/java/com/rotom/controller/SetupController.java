package com.rotom.controller;

import com.rotom.service.GoogleAuthService;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.Map;

@RestController
public class SetupController {

    private final GoogleAuthService googleAuthService;

    public SetupController(GoogleAuthService googleAuthService) {
        this.googleAuthService = googleAuthService;
    }

    @GetMapping("/api/setup/status")
    public Map<String, Object> getSetupStatus() {
        Map<String, Object> status = new HashMap<>();
        boolean credentialsExist = new File("credentials.json").exists();
        boolean tokenExists = new File("tokens/StoredCredential").exists();
        status.put("credentialsConfigured", credentialsExist);
        status.put("tokenExists", tokenExists);

        // If token exists but gmail not initialized yet (e.g. fresh server start), load it now
        if (tokenExists && !googleAuthService.isAuthenticated()) {
            try {
                googleAuthService.initFromStoredCredential();
            } catch (Exception ignored) {}
        }

        status.put("authenticated", googleAuthService.isAuthenticated());
        status.put("email", googleAuthService.getUserEmail());
        return status;
    }

    @PostMapping("/api/setup/credentials")
    public ResponseEntity<?> uploadCredentials(@RequestParam("file") MultipartFile file) {
        try {
            if (file.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "File is empty"));
            }
            String content = new String(file.getBytes());
            if (!content.contains("client_id") || !content.contains("client_secret")) {
                return ResponseEntity.badRequest().body(Map.of("error", "Invalid credentials file."));
            }
            Files.copy(file.getInputStream(), new File("credentials.json").toPath(), StandardCopyOption.REPLACE_EXISTING);
            return ResponseEntity.ok(Map.of("message", "credentials.json saved successfully"));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", "Failed to save: " + e.getMessage()));
        }
    }

    // Returns the Google OAuth URL for the frontend to redirect to
    @GetMapping("/api/setup/auth-url")
    public ResponseEntity<?> getAuthUrl() {
        try {
            String url = googleAuthService.getAuthorizationUrl();
            return ResponseEntity.ok(Map.of("url", url));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    // Google redirects here after the user approves
    @GetMapping("/oauth2callback")
    public void oauthCallback(@RequestParam(value = "code", required = false) String code,
                              @RequestParam(value = "error", required = false) String error,
                              HttpServletResponse response) throws Exception {
        if (error != null || code == null) {
            response.sendRedirect("/?oauth_error=access_denied");
            return;
        }
        try {
            googleAuthService.initFromCode(code);
            response.sendRedirect("/?oauth_success=true");
        } catch (Exception e) {
            response.sendRedirect("/?oauth_error=" + e.getMessage());
        }
    }
}
