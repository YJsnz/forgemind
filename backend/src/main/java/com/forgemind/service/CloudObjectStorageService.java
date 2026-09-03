package com.forgemind.service;

import com.forgemind.repository.CloudWorkspaceDbStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;

@Service
public class CloudObjectStorageService {
    private final CloudWorkspaceDbStore store;
    private final Path root;

    public CloudObjectStorageService(CloudWorkspaceDbStore store,
                                     @Value("${forgemind.cloud.object-root:./data/objects}") String objectRoot) {
        this.store = store;
        this.root = Path.of(objectRoot).toAbsolutePath().normalize();
    }

    public Map<String, Object> upload(String userId, String assetId, MultipartFile file) {
        if (file == null || file.isEmpty()) throw new IllegalArgumentException("资源文件不能为空");
        if (file.getOriginalFilename() == null || file.getOriginalFilename().isBlank()) throw new IllegalArgumentException("资源文件名不能为空");
        String safeName = Path.of(file.getOriginalFilename()).getFileName().toString();
        if (safeName.length() > 255) safeName = safeName.substring(safeName.length() - 255);
        Path temp = null;
        try {
            Files.createDirectories(root);
            temp = Files.createTempFile(root, "upload-", ".part");
            try (InputStream input = file.getInputStream()) {
                Files.copy(input, temp, StandardCopyOption.REPLACE_EXISTING);
            }
            String hash = sha256(temp);
            String objectKey = "assets/" + assetId + "/" + hash;
            Path target = safePath(objectKey);
            Files.createDirectories(target.getParent());
            if (!Files.exists(target)) Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
            else Files.deleteIfExists(temp);
            try {
                return store.registerAssetBlob(userId, assetId, objectKey, safeName,
                        file.getContentType(), Files.size(target), hash, "local");
            } catch (RuntimeException error) {
                if (!store.hasAssetBlob(userId, assetId, hash)) Files.deleteIfExists(target);
                throw error;
            }
        } catch (IOException error) {
            if (temp != null) try { Files.deleteIfExists(temp); } catch (IOException ignored) { }
            throw new IllegalArgumentException("资源文件写入对象存储失败", error);
        }
    }

    public Resource download(String userId, String blobId) {
        Map<String, Object> blob = store.getAssetBlob(userId, blobId);
        Path path = safePath(String.valueOf(blob.get("objectKey")));
        if (!Files.isRegularFile(path)) throw new IllegalArgumentException("资源文件本体不存在");
        store.recordAssetBlobDownload(userId, blob);
        return new FileSystemResource(path);
    }

    public void delete(String userId, String blobId) {
        Map<String, Object> blob = store.getAssetBlob(userId, blobId);
        Path path = safePath(String.valueOf(blob.get("objectKey")));
        try { Files.deleteIfExists(path); } catch (IOException error) { throw new IllegalArgumentException("资源文件删除失败", error); }
        store.deleteAssetBlob(userId, blobId);
    }

    public String contentType(String userId, String blobId) {
        return String.valueOf(store.getAssetBlob(userId, blobId).get("mediaType"));
    }

    public String fileName(String userId, String blobId) {
        return String.valueOf(store.getAssetBlob(userId, blobId).get("fileName"));
    }

    private Path safePath(String objectKey) {
        Path path = root.resolve(objectKey).normalize();
        if (!path.startsWith(root)) throw new IllegalArgumentException("非法对象路径");
        return path;
    }

    private String sha256(Path path) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = Files.newInputStream(path)) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) >= 0) if (read > 0) digest.update(buffer, 0, read);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("JVM 缺少 SHA-256", error);
        }
    }
}
