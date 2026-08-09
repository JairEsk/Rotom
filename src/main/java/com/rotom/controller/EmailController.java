package com.rotom.controller;

import com.rotom.dto.DeleteRequest;
import com.rotom.dto.DeleteResponse;
import com.rotom.dto.EmailPage;
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
        this.rotomMailService  = rotomMailService;
        this.googleAuthService = googleAuthService;
    }

    @GetMapping("/emails")
    public ResponseEntity<?> getEmails(
            @RequestParam(defaultValue = "10") int size,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String pageToken) {
        try {
            String q = (query != null && !query.isBlank()) ? query : "larger:" + size + "M";
            EmailPage page = rotomMailService.findEmails(q, pageToken);
            return ResponseEntity.ok(page);
        } catch (Exception e) {
            if (isAuthError(e)) return ResponseEntity.status(401).body(Map.of("error", e.getMessage()));
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/emails/trash")
    public ResponseEntity<?> trashEmails(@RequestBody TrashRequest request) {
        if (request.getIds() == null || request.getIds().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Email IDs must not be empty"));
        }
        try {
            TrashResponse response = rotomMailService.trashEmails(request.getIds());
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            if (isAuthError(e)) return ResponseEntity.status(401).body(Map.of("error", e.getMessage()));
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/emails/verify-trashed")
    public ResponseEntity<?> verifyTrashed(@RequestBody TrashRequest request) {
        if (request.getIds() == null || request.getIds().isEmpty()) {
            return ResponseEntity.ok(Map.of("trashedIds", List.of()));
        }
        try {
            List<String> confirmed = rotomMailService.verifyTrashed(request.getIds());
            return ResponseEntity.ok(Map.of("trashedIds", confirmed));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/emails/delete")
    public ResponseEntity<?> deleteForever(@RequestBody DeleteRequest request) {
        if (request.getIds() == null || request.getIds().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Email IDs must not be empty"));
        }
        try {
            DeleteResponse response = rotomMailService.deleteEmailsPermanently(request.getIds());
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            if (isAuthError(e)) return ResponseEntity.status(401).body(Map.of("error", e.getMessage()));
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/storage")
    public ResponseEntity<?> getStorageInfo() {
        try {
            Map<String, Object> storageInfo = rotomMailService.getStorageInfo();
            return ResponseEntity.ok(storageInfo);
        } catch (Exception e) {
            if (isAuthError(e)) return ResponseEntity.status(401).body(Map.of("error", e.getMessage()));
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    private boolean isAuthError(Exception e) {
        String msg = e.getMessage() != null ? e.getMessage().toLowerCase() : "";
        return msg.contains("token") || msg.contains("401") ||
               msg.contains("unauthorized") || msg.contains("invalid_grant");
    }
}
