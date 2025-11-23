package edu.smu.agent.controller;

import java.util.HashMap;
import java.util.Map;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import edu.smu.agent.service.DifyChatFlowService;
import io.github.imfangs.dify.client.model.chat.ChatMessageResponse;
import io.github.imfangs.dify.client.model.chat.Conversation;
import io.github.imfangs.dify.client.model.chat.ConversationListResponse;
import io.github.imfangs.dify.client.model.chat.MessageListResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
@RequestMapping("/api/chat")
@RequiredArgsConstructor
@CrossOrigin(origins = "*") // 允许跨域请求
public class ChatController {

    private final DifyChatFlowService difyChatFlowService;

    /**
     * 发送消息
     */
    @PostMapping("/send")
    public ResponseEntity<Map<String, Object>> sendMessage(@RequestBody Map<String, String> request) {
        try {
            String query = request.get("message");
            String userId = request.get("userId");

            if (query == null || userId == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "消息和用户ID不能为空"));
            }

            String conversationId = request.get("conversationId");

            ChatMessageResponse response = difyChatFlowService.sendMessage(query, userId, conversationId);

            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("messageId", response.getMessageId());
            result.put("conversationId", response.getConversationId());
            result.put("answer", response.getAnswer());
            result.put("mode", response.getMode());
            result.put("createdAt", response.getCreatedAt());

            // 如果有元数据，也返回
            if (response.getMetadata() != null) {
                result.put("metadata", response.getMetadata());
            }

            return ResponseEntity.ok(result);

        } catch (Exception e) {
            log.error("发送消息失败", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 发送流式消息
     */
    @PostMapping(value = "/send-stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter sendStreamMessage(@RequestBody Map<String, String> request) {
        String query = request.get("message");
        String userId = request.get("userId");
        String conversationId = request.get("conversationId");

        if (query == null || userId == null) {
            throw new ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST, "消息和用户ID不能为空");
        }

        return difyChatFlowService.sendStreamMessage(query, userId, conversationId);
    }

    /**
     * 获取会话历史
     */
    @GetMapping("/history/{conversationId}")
    public ResponseEntity<Map<String, Object>> getMessageHistory(
            @PathVariable String conversationId,
            @RequestParam String userId,
            @RequestParam(defaultValue = "20") Integer limit) {
        try {
            MessageListResponse response = difyChatFlowService.getMessageHistory(conversationId, userId, limit);

            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("data", response.getData());
            result.put("hasMore", response.getHasMore());
            result.put("limit", response.getLimit());

            return ResponseEntity.ok(result);

        } catch (Exception e) {
            log.error("获取消息历史失败", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 获取用户会话列表
     */
    @GetMapping("/conversations")
    public ResponseEntity<Map<String, Object>> getConversations(
            @RequestParam String userId,
            @RequestParam(defaultValue = "20") Integer limit) {
        try {
            ConversationListResponse response = difyChatFlowService.getConversations(userId, limit);

            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("data", response.getData());
            result.put("hasMore", response.getHasMore());
            result.put("limit", response.getLimit());

            return ResponseEntity.ok(result);

        } catch (Exception e) {
            log.error("获取会话列表失败", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 删除会话
     */
    @DeleteMapping("/conversations/{conversationId}")
    public ResponseEntity<Map<String, Object>> deleteConversation(
            @PathVariable String conversationId,
            @RequestParam String userId) {
        try {
            difyChatFlowService.deleteConversation(conversationId, userId);

            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("message", "会话删除成功");

            return ResponseEntity.ok(result);

        } catch (Exception e) {
            log.error("删除会话失败", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 重命名会话
     */
    @PutMapping("/conversations/{conversationId}/name")
    public ResponseEntity<Map<String, Object>> renameConversation(
            @PathVariable String conversationId,
            @RequestBody Map<String, String> request) {
        try {
            String name = request.get("name");
            String userId = request.get("userId");

            if (name == null || userId == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "名称和用户ID不能为空"));
            }

            Conversation conversation = difyChatFlowService.renameConversation(conversationId, name, userId);

            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("conversation", conversation);

            return ResponseEntity.ok(result);

        } catch (Exception e) {
            log.error("重命名会话失败", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

}