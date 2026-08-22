package com.forgemind.service;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import java.io.IOException;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

@Service
public class AgentEventHub {
    private final ConcurrentHashMap<String, CopyOnWriteArrayList<SseEmitter>> streams=new ConcurrentHashMap<>();
    public SseEmitter open(String runId){SseEmitter e=new SseEmitter(15*60_000L);streams.computeIfAbsent(runId,k->new CopyOnWriteArrayList<>()).add(e);Runnable remove=()->streams.getOrDefault(runId,new CopyOnWriteArrayList<>()).remove(e);e.onCompletion(remove);e.onTimeout(remove);e.onError(x->remove.run());try{e.send(SseEmitter.event().name("ready").data("{}"));}catch(IOException ignored){}return e;}
    public void publish(String runId,String event,JsonNode data){List<SseEmitter> list=streams.getOrDefault(runId,new CopyOnWriteArrayList<>());for(SseEmitter e:list)try{e.send(SseEmitter.event().name(event).data(data.toString()));}catch(IOException ex){list.remove(e);}}
}
