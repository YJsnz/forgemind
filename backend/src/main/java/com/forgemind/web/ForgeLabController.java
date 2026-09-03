package com.forgemind.web;

import com.forgemind.model.User;
import com.forgemind.repository.ForgeLabDbStore;
import com.forgemind.service.AuthService;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/forgelab")
@CrossOrigin(origins = "*")
public class ForgeLabController {
    private final ForgeLabDbStore store;
    private final AuthService auth;

    public ForgeLabController(ForgeLabDbStore store, AuthService auth) {
        this.store = store;
        this.auth = auth;
    }

    @GetMapping("/posts")
    public List<Map<String, Object>> posts(@RequestHeader(value = "Authorization", defaultValue = "") String authorization) {
        return store.listPosts(auth.currentUser(authorization).id());
    }

    @GetMapping("/posts/{postId}")
    public Map<String, Object> post(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String postId) {
        return store.getPost(auth.currentUser(authorization).id(), postId);
    }

    @PostMapping(value = "/posts", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> createPost(
            @RequestHeader(value = "Authorization", defaultValue = "") String authorization,
            @RequestPart("metadata") String metadata,
            @RequestPart(value = "image", required = false) MultipartFile image,
            @RequestPart(value = "archive", required = false) MultipartFile archive
    ) {
        return store.createPost(auth.currentUser(authorization).id(), metadata, image, archive);
    }

    @PostMapping("/posts/{postId}/like")
    public Map<String, Object> likePost(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String postId) {
        return store.togglePostLike(auth.currentUser(authorization).id(), postId);
    }

    public record ReplyRequest(String content) {}

    @PostMapping("/posts/{postId}/replies")
    public Map<String, Object> reply(
            @RequestHeader(value = "Authorization", defaultValue = "") String authorization,
            @PathVariable String postId,
            @RequestBody ReplyRequest request
    ) {
        if (request == null) throw new IllegalArgumentException("回复请求不能为空");
        return store.createReply(auth.currentUser(authorization).id(), postId, request.content());
    }

    @PostMapping("/replies/{replyId}/like")
    public Map<String, Object> likeReply(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String replyId) {
        return store.toggleReplyLike(auth.currentUser(authorization).id(), replyId);
    }

    @GetMapping("/notifications")
    public List<Map<String, Object>> notifications(@RequestHeader(value = "Authorization", defaultValue = "") String authorization) {
        return store.notifications(auth.currentUser(authorization).id());
    }

    @PostMapping("/notifications/read-all")
    public Map<String, Boolean> readAll(@RequestHeader(value = "Authorization", defaultValue = "") String authorization) {
        store.markAllNotificationsRead(auth.currentUser(authorization).id());
        return Map.of("ok", true);
    }

    @PostMapping("/notifications/{notificationId}/read")
    public Map<String, Boolean> read(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String notificationId) {
        store.markNotificationRead(auth.currentUser(authorization).id(), notificationId);
        return Map.of("ok", true);
    }

    @GetMapping("/attachments/{attachmentId}/download")
    public ResponseEntity<ByteArrayResource> download(
            @RequestHeader(value = "Authorization", defaultValue = "") String authorization,
            @PathVariable String attachmentId
    ) {
        User user = auth.currentUser(authorization);
        ForgeLabDbStore.AttachmentPayload payload = store.attachment(user.id(), attachmentId);
        if (payload.externalUrl() != null && payload.bytes() == null) {
            return ResponseEntity.status(302).header(HttpHeaders.LOCATION, payload.externalUrl()).build();
        }
        MediaType mediaType;
        try {
            mediaType = MediaType.parseMediaType(payload.contentType());
        } catch (IllegalArgumentException e) {
            mediaType = MediaType.APPLICATION_OCTET_STREAM;
        }
        ContentDisposition disposition = ContentDisposition.attachment().filename(payload.fileName(), StandardCharsets.UTF_8).build();
        byte[] bytes = payload.bytes() == null ? new byte[0] : payload.bytes();
        return ResponseEntity.ok().contentType(mediaType).contentLength(bytes.length)
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString()).body(new ByteArrayResource(bytes));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> onBadRequest(IllegalArgumentException error) {
        return ResponseEntity.badRequest().body(Map.of("error", error.getMessage() == null ? "ForgeLab 请求非法" : error.getMessage()));
    }
}
