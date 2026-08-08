package com.rotom.controller;

import com.rotom.dto.EmailItem;
import com.rotom.dto.TrashRequest;
import com.rotom.dto.TrashResponse;
import com.rotom.service.GoogleAuthService;
import com.rotom.service.RotomMailService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class EmailController {

    private final RotomMailService rotomMailService;
    private final GoogleAuthService googleAuthService;

    public EmailController(RotomMailService rotomMailService, GoogleAuthService googleAuthService) {
        this.rotomMailService = rotomMailService;
        this.googleAuthService = googleAuthService;
    }

    @GetMapping("/auth/status")
    public Map<String, Object> getAuthStatus() {
        Map<String, Object> status = new HashMap<>();
        try {
            boolean authenticated = googleAuthService.isAuthenticated();
            status.put("authenticated", authenticated);
            status.put("email", authenticated ? googleAuthService.getUserEmail() : null);
        } catch (Exception e) {
            status.put("authenticated", false);
            status.put("email", null);
            status.put("error", "Gmail not configured: " + e.getMessage());
        }
        return status;
    }

    @GetMapping("/emails")
    public ResponseEntity<?> getLargeEmails(@RequestParam(defaultValue = "10") int size) {
        try {
            List<EmailItem> emails = rotomMailService.findLargeEmails(size);
            return ResponseEntity.ok(emails);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/emails/trash")
    public ResponseEntity<?> trashEmails(@RequestBody TrashRequest request) {
        if (request.getIds() == null || request.getIds().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Email IDs must not be null or empty"));
        }
        try {
            TrashResponse response = rotomMailService.trashEmails(request.getIds());
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/storage")
    public ResponseEntity<?> getStorageInfo() {
        try {
            Map<String, Object> storageInfo = rotomMailService.getStorageInfo();
            return ResponseEntity.ok(storageInfo);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }
}
