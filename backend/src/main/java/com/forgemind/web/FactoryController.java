package com.forgemind.web;

import com.forgemind.model.FactorySave;
import com.forgemind.store.JsonStore;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 工厂存档 REST 接口（极薄 CRUD）。
 * GET/PUT /api/factory —— 整厂存档的读取与写入。
 */
@RestController
@RequestMapping("/api/factory")
@CrossOrigin(origins = "*")
public class FactoryController {

    private final JsonStore store;

    public FactoryController(JsonStore store) {
        this.store = store;
    }

    @GetMapping
    public FactorySave getFactory() {
        return store.load();
    }

    @PutMapping
    public FactorySave saveFactory(@RequestBody FactorySave save) {
        store.save(save);
        return save;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("status", "ok", "service", "forgemind-backend");
    }
}
