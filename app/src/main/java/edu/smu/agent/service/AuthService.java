package edu.smu.agent.service;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 简单的内存登录服务，使用写死的账号密码用于演示。
 */
@Service
public class AuthService {

    private static final Map<String, UserInfo> USERS = Map.of(
            "enterprise", new UserInfo("enterprise", "enterprise123", "ENTERPRISE", "企业用户"),
            "admin", new UserInfo("admin", "admin123", "ADMIN", "管理员")
    );

    private final Map<String, Session> sessions = new ConcurrentHashMap<>();

    public Session login(String username, String password) {
        UserInfo info = USERS.get(username);
        if (info == null || !info.password().equals(password)) {
            return null;
        }

        String token = UUID.randomUUID().toString();
        Session session = new Session(token, info.username(), info.role(), info.displayName(), Instant.now());
        sessions.put(token, session);
        return session;
    }

    public Session validate(String token) {
        return token == null ? null : sessions.get(token);
    }

    public record Session(String token, String username, String role, String displayName, Instant createdAt) {
    }

    private static record UserInfo(String username, String password, String role, String displayName) {
    }
}
