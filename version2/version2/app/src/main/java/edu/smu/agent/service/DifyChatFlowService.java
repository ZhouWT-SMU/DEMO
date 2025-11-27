package edu.smu.agent.service;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import io.github.imfangs.dify.client.DifyChatflowClient;
import io.github.imfangs.dify.client.DifyClientFactory;
import io.github.imfangs.dify.client.callback.ChatStreamCallback;
import io.github.imfangs.dify.client.enums.ResponseMode;
import io.github.imfangs.dify.client.event.AgentLogEvent;
import io.github.imfangs.dify.client.event.AgentMessageEvent;
import io.github.imfangs.dify.client.event.AgentThoughtEvent;
import io.github.imfangs.dify.client.event.ErrorEvent;
import io.github.imfangs.dify.client.event.MessageEndEvent;
import io.github.imfangs.dify.client.event.MessageEvent;
import io.github.imfangs.dify.client.event.MessageFileEvent;
import io.github.imfangs.dify.client.event.MessageReplaceEvent;
import io.github.imfangs.dify.client.event.PingEvent;
import io.github.imfangs.dify.client.event.TtsMessageEndEvent;
import io.github.imfangs.dify.client.event.TtsMessageEvent;
import io.github.imfangs.dify.client.model.chat.ChatMessage;
import io.github.imfangs.dify.client.model.chat.ChatMessageResponse;
import io.github.imfangs.dify.client.model.chat.Conversation;
import io.github.imfangs.dify.client.model.chat.ConversationListResponse;
import io.github.imfangs.dify.client.model.chat.MessageListResponse;
import lombok.extern.slf4j.Slf4j;

/**
 * Dify 服务类
 * 封装 Dify Chatflow API 调用
 */
@Slf4j
@Service
public class DifyChatFlowService {

    @Value("${dify.base-url}")
    private String baseUrl;

    @Value("${dify.chatflow-api-key}")
    private String chatflowApiKey;

    /**
     * 发送消息（阻塞模式）
     */
    public ChatMessageResponse sendMessage(String query, String userId, String conversationId) {
        try (DifyChatflowClient client = DifyClientFactory.createChatWorkflowClient(baseUrl, chatflowApiKey)) {
            ChatMessage message = ChatMessage.builder()
                    .query(query)
                    .user(userId)
                    .responseMode(ResponseMode.BLOCKING)
                    .build();

            if (StringUtils.hasText(conversationId)) {
                message.setConversationId(conversationId);
            }

            log.info("发送消息: user={}, query={}", userId, query);
            ChatMessageResponse response = client.sendChatMessage(message);
            log.info("收到响应: messageId={}", response.getMessageId());

            return response;
        } catch (Exception e) {
            log.error("发送消息失败: user={}, query={}", userId, query, e);
            throw new RuntimeException("发送消息失败: " + e.getMessage(), e);
        }
    }

    /**
     * 发送消息（流式模式）
     */
    public SseEmitter sendStreamMessage(String query, String userId, String conversationId) {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> messageIdRef = new AtomicReference<>();
        AtomicReference<String> conversationIdRef = new AtomicReference<>(conversationId);
        AtomicReference<Throwable> errorRef = new AtomicReference<>();
        AtomicBoolean finished = new AtomicBoolean(false);
        StringBuilder answerBuilder = new StringBuilder();

        SseEmitter emitter = new SseEmitter(TimeUnit.MINUTES.toMillis(5));
        emitter.onTimeout(() -> {
            log.warn("SSE连接超时，发送已收集内容并结束");
            try {
                String resolvedConversationId = conversationIdRef.get();
                if (!StringUtils.hasText(resolvedConversationId)) {
                    resolvedConversationId = StringUtils.hasText(conversationId) ? conversationId : messageIdRef.get();
                }

                Map<String, Object> payload = new HashMap<>();
                payload.put("messageId", messageIdRef.get());
                payload.put("conversationId", resolvedConversationId);
                payload.put("answer", answerBuilder.toString());
                payload.put("createdAt", System.currentTimeMillis());
                emitter.send(SseEmitter.event().name("done").data(payload));
            } catch (Exception e) {
                log.warn("超时回传内容失败", e);
            } finally {
                latch.countDown();
                emitter.complete();
            }
        });

        try (DifyChatflowClient client = DifyClientFactory.createChatWorkflowClient(baseUrl, chatflowApiKey)) {
            ChatMessage message = ChatMessage.builder()
                    .query(query)
                    .user(userId)
                    .responseMode(ResponseMode.STREAMING)
                    .build();

            if (StringUtils.hasText(conversationId)) {
                message.setConversationId(conversationId);
            }

            log.info("发送流式消息: user={}, query={}, conversationId={}", userId, query, conversationId);

            client.sendChatMessageStream(message, new ChatStreamCallback() {
                @Override
                public void onMessage(MessageEvent event) {
                    log.info("收到消息片段: {}", event.getAnswer());
                    answerBuilder.append(event.getAnswer());

                    try {
                        emitter.send(SseEmitter.event()
                                .name("chunk")
                                .data(event.getAnswer(), MediaType.TEXT_PLAIN));
                    } catch (Exception e) {
                        log.warn("发送流式片段到前端失败", e);
                    }

                    try {
                        if (StringUtils.hasText(event.getConversationId())) {
                            conversationIdRef.set(event.getConversationId());
                        }
                    } catch (Exception e) {
                        log.debug("流式片段未包含会话ID");
                    }
                }

                @Override
                public void onMessageEnd(MessageEndEvent event) {
                    log.info("消息结束，完整消息ID: {}", event.getMessageId());
                    messageIdRef.set(event.getMessageId());

                    if (StringUtils.hasText(event.getConversationId())) {
                        conversationIdRef.set(event.getConversationId());
                    }

                    String resolvedConversationId = conversationIdRef.get();
                    if (!StringUtils.hasText(resolvedConversationId)) {
                        resolvedConversationId = event.getMessageId();
                        conversationIdRef.set(resolvedConversationId);
                    }

                    Map<String, Object> payload = new HashMap<>();
                    payload.put("messageId", messageIdRef.get());
                    payload.put("conversationId", resolvedConversationId);
                    payload.put("answer", answerBuilder.toString());
                    payload.put("createdAt", System.currentTimeMillis());

                    try {
                        emitter.send(SseEmitter.event().name("done").data(payload));
                        emitter.complete();
                        finished.set(true);
                    } catch (Exception e) {
                        log.warn("发送完成事件失败", e);
                        emitter.completeWithError(e);
                    }

                    latch.countDown();
                }

                @Override
                public void onMessageFile(MessageFileEvent event) {
                    log.info("收到文件: {}", event);
                }

                @Override
                public void onTTSMessage(TtsMessageEvent event) {
                    log.info("收到TTS消息: {}", event);
                }

                @Override
                public void onTTSMessageEnd(TtsMessageEndEvent event) {
                    log.info("TTS消息结束: {}", event);
                }

                @Override
                public void onMessageReplace(MessageReplaceEvent event) {
                    log.info("消息替换: {}", event);
                }

                @Override
                public void onAgentMessage(AgentMessageEvent event) {
                    log.info("Agent消息: {}", event);
                }

                @Override
                public void onAgentThought(AgentThoughtEvent event) {
                    log.info("Agent思考: {}", event);
                }

                @Override
                public void onAgentLog(AgentLogEvent event) {
                    log.info("Agent日志: {}", event);
                }

                @Override
                public void onError(ErrorEvent event) {
                    log.error("流式响应错误: {}", event.getMessage());
                    errorRef.set(new RuntimeException("流式响应错误: " + event.getMessage()));
                    try {
                        emitter.send(SseEmitter.event().name("error").data(event.getMessage()));
                    } catch (Exception e) {
                        log.warn("发送错误事件失败", e);
                    }
                    latch.countDown();
                }

                @Override
                public void onException(Throwable throwable) {
                    log.error("流式响应异常: {}", throwable.getMessage(), throwable);
                    errorRef.set(new RuntimeException("流式响应异常: " + throwable.getMessage(), throwable));
                    try {
                        emitter.send(SseEmitter.event().name("error").data(throwable.getMessage()));
                    } catch (Exception e) {
                        log.warn("发送异常事件失败", e);
                    }
                    latch.countDown();
                }

                @Override
                public void onPing(PingEvent event) {
                    log.info("心跳: {}", event);
                }
            });

            boolean completed = latch.await(180, TimeUnit.SECONDS);

            Throwable throwable = errorRef.get();
            if (throwable != null) {
                emitter.completeWithError(throwable);
                throw new RuntimeException("流式响应失败", throwable);
            }

            if (!completed && !finished.get()) {
                log.error("流式响应超时，已收集的内容: {}", answerBuilder);

                try {
                    String resolvedConversationId = conversationIdRef.get();
                    if (!StringUtils.hasText(resolvedConversationId)) {
                        resolvedConversationId = StringUtils.hasText(conversationId) ? conversationId : messageIdRef.get();
                    }

                    Map<String, Object> payload = new HashMap<>();
                    payload.put("messageId", messageIdRef.get());
                    payload.put("conversationId", resolvedConversationId);
                    payload.put("answer", answerBuilder.toString());
                    payload.put("createdAt", System.currentTimeMillis());
                    emitter.send(SseEmitter.event().name("done").data(payload));
                } catch (Exception sendException) {
                    log.warn("超时发送已收集内容失败", sendException);
                }

                emitter.complete();
                return emitter;
            }

            return emitter;

        } catch (Exception e) {
            log.error("发送流式消息失败: user={}, query={}", userId, query, e);
            emitter.completeWithError(e);
            throw new RuntimeException("发送流式消息失败: " + e.getMessage(), e);
        }
    }

    /**
     * 获取会话历史
     */
    public MessageListResponse getMessageHistory(String conversationId, String userId, Integer limit) {
        try (DifyChatflowClient client = DifyClientFactory.createChatWorkflowClient(baseUrl, chatflowApiKey)) {
            return client.getMessages(conversationId, userId, null, limit != null ? limit : 20);
        } catch (Exception e) {
            log.error("获取消息历史失败: conversationId={}, userId={}", conversationId, userId, e);
            throw new RuntimeException("获取消息历史失败: " + e.getMessage(), e);
        }
    }

    /**
     * 获取用户会话列表
     */
    public ConversationListResponse getConversations(String userId, Integer limit) {
        try (DifyChatflowClient client = DifyClientFactory.createChatWorkflowClient(baseUrl, chatflowApiKey)) {
            return client.getConversations(userId, null, limit != null ? limit : 20, "updated_at");
        } catch (Exception e) {
            log.error("获取会话列表失败: userId={}", userId, e);
            throw new RuntimeException("获取会话列表失败: " + e.getMessage(), e);
        }
    }

    /**
     * 删除会话
     */
    public void deleteConversation(String conversationId, String userId) {
        try (DifyChatflowClient client = DifyClientFactory.createChatWorkflowClient(baseUrl, chatflowApiKey)) {
            client.deleteConversation(conversationId, userId);
            log.info("删除会话成功: conversationId={}, userId={}", conversationId, userId);
        } catch (Exception e) {
            log.error("删除会话失败: conversationId={}, userId={}", conversationId, userId, e);
            throw new RuntimeException("删除会话失败: " + e.getMessage(), e);
        }
    }

    /**
     * 重命名会话
     */
    public Conversation renameConversation(String conversationId, String name, String userId) {
        try (DifyChatflowClient client = DifyClientFactory.createChatWorkflowClient(baseUrl, chatflowApiKey)) {
            Conversation conversation = client.renameConversation(conversationId, name, false, userId);
            log.info("重命名会话成功: conversationId={}, name={}, userId={}", conversationId, name, userId);
            return conversation;
        } catch (Exception e) {
            log.error("重命名会话失败: conversationId={}, name={}, userId={}", conversationId, name, userId, e);
            throw new RuntimeException("重命名会话失败: " + e.getMessage(), e);
        }
    }
}