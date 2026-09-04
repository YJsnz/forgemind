package com.forgemind.service;

public class AuthRateLimitException extends RuntimeException {
    public AuthRateLimitException(String message) {
        super(message);
    }
}
