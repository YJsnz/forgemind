package com.forgemind;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class ForgeMindApplication {
    public static void main(String[] args) {
        SpringApplication.run(ForgeMindApplication.class, args);
    }
}
