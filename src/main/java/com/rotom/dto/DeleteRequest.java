package com.rotom.dto;

import java.util.List;

public class DeleteRequest {
    private List<String> ids;
    public List<String> getIds()            { return ids; }
    public void setIds(List<String> ids)    { this.ids = ids; }
}
