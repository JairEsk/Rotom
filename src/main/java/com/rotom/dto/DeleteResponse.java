package com.rotom.dto;

public class DeleteResponse {
    private int deletedCount;
    private int failedCount;
    private String message;

    public DeleteResponse(int deletedCount, int failedCount, String message) {
        this.deletedCount = deletedCount;
        this.failedCount  = failedCount;
        this.message      = message;
    }

    public int getDeletedCount()  { return deletedCount; }
    public int getFailedCount()   { return failedCount; }
    public String getMessage()    { return message; }
}
