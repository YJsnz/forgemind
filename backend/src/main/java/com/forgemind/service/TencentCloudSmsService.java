package com.forgemind.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.Map;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

@Service
public class TencentCloudSmsService {
    private static final String HOST = "sms.tencentcloudapi.com";
    private static final String SERVICE = "sms";
    private static final String ACTION = "SendSms";
    private static final String VERSION = "2021-01-11";
    private static final DateTimeFormatter UTC_DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneOffset.UTC);

    private final ObjectMapper json;
    private final HttpClient http;
    private final boolean enabled;
    private final String secretId;
    private final String secretKey;
    private final String region;
    private final String sdkAppId;
    private final String signName;
    private final String templateId;

    public TencentCloudSmsService(
            ObjectMapper json,
            @Value("${forgemind.sms.enabled:false}") boolean enabled,
            @Value("${forgemind.sms.secret-id:}") String secretId,
            @Value("${forgemind.sms.secret-key:}") String secretKey,
            @Value("${forgemind.sms.region:ap-guangzhou}") String region,
            @Value("${forgemind.sms.sdk-app-id:}") String sdkAppId,
            @Value("${forgemind.sms.sign-name:}") String signName,
            @Value("${forgemind.sms.template-id:}") String templateId
    ) {
        this.json = json;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        this.enabled = enabled;
        this.secretId = secretId == null ? "" : secretId.trim();
        this.secretKey = secretKey == null ? "" : secretKey.trim();
        this.region = region == null ? "" : region.trim();
        this.sdkAppId = sdkAppId == null ? "" : sdkAppId.trim();
        this.signName = signName == null ? "" : signName.trim();
        this.templateId = templateId == null ? "" : templateId.trim();
    }

    public boolean isConfigured() {
        return enabled && !secretId.isBlank() && !secretKey.isBlank()
                && !region.isBlank() && !sdkAppId.isBlank() && !signName.isBlank() && !templateId.isBlank();
    }

    public void sendVerificationCode(String phone, String code) {
        if (!isConfigured()) {
            throw new IllegalStateException("腾讯云短信尚未配置，请设置短信开关、密钥、SDK AppID、签名和模板 ID");
        }
        try {
            String body = json.writeValueAsString(Map.of(
                    "SmsSdkAppId", sdkAppId,
                    "SignName", signName,
                    "TemplateId", templateId,
                    "TemplateParamSet", new String[]{code},
                    "PhoneNumberSet", new String[]{phone}
            ));
            long timestamp = Instant.now().getEpochSecond();
            String authorization = sign(body, timestamp);
            HttpRequest request = HttpRequest.newBuilder(URI.create("https://" + HOST))
                    .timeout(Duration.ofSeconds(8))
                    .header("Content-Type", "application/json; charset=utf-8")
                    .header("Host", HOST)
                    .header("X-TC-Action", ACTION)
                    .header("X-TC-Version", VERSION)
                    .header("X-TC-Region", region)
                    .header("X-TC-Timestamp", Long.toString(timestamp))
                    .header("Authorization", authorization)
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("腾讯云短信请求失败（HTTP " + response.statusCode() + "）");
            }
            JsonNode root = json.readTree(response.body());
            JsonNode error = root.path("Response").path("Error");
            if (!error.isMissingNode() && !error.isNull()) {
                throw new IllegalStateException("腾讯云短信发送失败：" + error.path("Message").asText("未知错误"));
            }
            JsonNode status = root.path("Response").path("SendStatusSet").path(0);
            if (!status.isMissingNode() && !"Ok".equalsIgnoreCase(status.path("Code").asText())) {
                throw new IllegalStateException("腾讯云短信发送失败：" + status.path("Message").asText("未知错误"));
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("腾讯云短信请求被中断", e);
        } catch (IOException e) {
            throw new IllegalStateException("腾讯云短信服务暂时不可用", e);
        }
    }

    private String sign(String payload, long timestamp) {
        String date = UTC_DATE.format(Instant.ofEpochSecond(timestamp));
        String hashedPayload = sha256(payload);
        String canonicalHeaders = "content-type:application/json; charset=utf-8\nhost:" + HOST + "\n";
        String canonicalRequest = "POST\n/\n\n" + canonicalHeaders + "\ncontent-type;host\n" + hashedPayload;
        String credentialScope = date + "/" + SERVICE + "/tc3_request";
        String stringToSign = "TC3-HMAC-SHA256\n" + timestamp + "\n" + credentialScope + "\n" + sha256(canonicalRequest);
        byte[] secretDate = hmac("TC3" + secretKey, date);
        byte[] secretService = hmac(secretDate, SERVICE);
        byte[] secretSigning = hmac(secretService, "tc3_request");
        String signature = HexFormat.of().formatHex(hmac(secretSigning, stringToSign));
        return "TC3-HMAC-SHA256 Credential=" + secretId + "/" + credentialScope
                + ", SignedHeaders=content-type;host, Signature=" + signature;
    }

    private static String sha256(String input) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }

    private static byte[] hmac(String key, String input) {
        return hmac(key.getBytes(StandardCharsets.UTF_8), input);
    }

    private static byte[] hmac(byte[] key, String input) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(input.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 不可用", e);
        }
    }
}
