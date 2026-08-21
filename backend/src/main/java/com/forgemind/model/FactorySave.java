package com.forgemind.model;

import java.util.List;
import java.util.Map;

/**
 * 工厂存档模型（对应前端 FactorySave）。
 * 极薄后端只做静态结构的 CRUD，仿真运行时仍在引擎（前端本地 / 未来 Java 引擎）。
 */
public record FactorySave(
        Integer version,
        String savedAt,
        List<Map<String, Object>> objects,
        List<Map<String, Object>> items,
        List<Map<String, Object>> recipes
) {}
