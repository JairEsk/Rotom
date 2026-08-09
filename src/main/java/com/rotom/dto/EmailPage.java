package com.rotom.dto;

import java.util.List;

public class EmailPage {

    private List<EmailItem> emails;
    private String nextPageToken;
    private int count;
    private boolean hasMore;

    public EmailPage(List<EmailItem> emails, String nextPageToken) {
        this.emails = emails;
        this.nextPageToken = nextPageToken;
        this.count = emails.size();
        this.hasMore = nextPageToken != null;
    }

    public List<EmailItem> getEmails()       { return emails; }
    public String getNextPageToken()          { return nextPageToken; }
    public int getCount()                     { return count; }
    public boolean isHasMore()               { return hasMore; }
}
