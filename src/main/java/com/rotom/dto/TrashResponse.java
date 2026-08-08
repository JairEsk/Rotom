package com.rotom.dto;

public class TrashResponse {

    private int trashedCount;
    private int failedCount;
    private String message;

    public TrashResponse() {
    }

    public TrashResponse(int trashedCount, int failedCount, String message) {
        this.trashedCount = trashedCount;
        this.failedCount = failedCount;
        this.message = message;
    }

    public int getTrashedCount() {
        return trashedCount;
    }

    public void setTrashedCount(int trashedCount) {
        this.trashedCount = trashedCount;
    }

    public int getFailedCount() {
        return failedCount;
    }

    public void setFailedCount(int failedCount) {
        this.failedCount = failedCount;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }
}
