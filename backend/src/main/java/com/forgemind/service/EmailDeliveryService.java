package com.forgemind.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.stereotype.Service;

import java.util.Properties;

@Service
public class EmailDeliveryService {
    private final JavaMailSenderImpl sender;
    private final boolean enabled;
    private final String from;

    public EmailDeliveryService(
            @Value("${forgemind.email.enabled:false}") boolean enabled,
            @Value("${forgemind.email.host:}") String host,
            @Value("${forgemind.email.port:587}") int port,
            @Value("${forgemind.email.username:}") String username,
            @Value("${forgemind.email.password:}") String password,
            @Value("${forgemind.email.from:}") String from,
            @Value("${forgemind.email.starttls:true}") boolean starttls
    ) {
        this.enabled = enabled;
        this.from = from == null ? "" : from.trim();
        this.sender = new JavaMailSenderImpl();
        this.sender.setHost(host == null ? "" : host.trim());
        this.sender.setPort(port);
        this.sender.setUsername(username == null ? "" : username.trim());
        this.sender.setPassword(password == null ? "" : password);
        Properties properties = this.sender.getJavaMailProperties();
        properties.put("mail.smtp.auth", "true");
        properties.put("mail.smtp.starttls.enable", Boolean.toString(starttls));
        properties.put("mail.smtp.starttls.required", Boolean.toString(starttls));
        properties.put("mail.smtp.connectiontimeout", "8000");
        properties.put("mail.smtp.timeout", "8000");
        properties.put("mail.smtp.writetimeout", "8000");
    }

    public boolean isConfigured() {
        return enabled && !sender.getHost().isBlank() && sender.getPort() > 0
                && !sender.getUsername().isBlank() && !sender.getPassword().isBlank() && !from.isBlank();
    }

    public void sendVerificationCode(String email, String code) {
        if (!isConfigured()) {
            throw new IllegalStateException("邮箱验证码尚未配置，请设置 SMTP 开关、服务器、账号、授权码和发件地址");
        }
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(email);
        message.setSubject("ForgePass 登录验证码");
        message.setText("你的 ForgePass 验证码是 " + code + "，5 分钟内有效。若非本人操作，请忽略此邮件。\n\nForgeMind");
        sender.send(message);
    }
}
