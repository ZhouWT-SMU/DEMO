package edu.smu.agent.controller;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import edu.smu.agent.service.DifyChatFlowService;
import io.github.imfangs.dify.client.model.chat.ChatMessageResponse;
import io.github.imfangs.dify.client.model.chat.Conversation;
import io.github.imfangs.dify.client.model.chat.ConversationListResponse;
import lombok.extern.slf4j.Slf4j;

/**
 * ChatController 测试类
 */
@Slf4j
@ExtendWith(MockitoExtension.class)
@SuppressWarnings("all")
class ChatControllerTest {

    @Mock
    private DifyChatFlowService difyChatFlowService;

    @InjectMocks
    private ChatController chatController;

    private ChatMessageResponse mockResponse;
    private Conversation mockConversation;

    @BeforeEach
    @SuppressWarnings("unused")
    void setUp() {
        // 设置模拟响应数据
        mockResponse = ChatMessageResponse.builder()
                .messageId("msg-123")
                .conversationId("conv-456")
                .answer("这是一个测试回复")
                .mode("chat")
                .createdAt(System.currentTimeMillis())
                .build();

        mockConversation = Conversation.builder()
                .id("conv-456")
                .name("测试会话")
                .createdAt(System.currentTimeMillis())
                .updatedAt(System.currentTimeMillis())
                .build();
    }

    @Test
    void testSendMessage_Success() {
        // 准备测试数据
        String message = "你好";
        String userId = "user-123";

        // 模拟请求
        Map<String, String> request = new HashMap<>();
        request.put("message", message);
        request.put("userId", userId);

        // 模拟服务层方法
        when(difyChatFlowService.sendMessage(message, userId, null)).thenReturn(mockResponse);

        // 执行测试
        ResponseEntity<Map<String, Object>> response = chatController.sendMessage(request);

        // 验证结果
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());

        Map<String, Object> body = response.getBody();
        log.info("回复：{}", body);
        assertNotNull(body);
        assertTrue((Boolean) body.get("success"));
        assertEquals("msg-123", body.get("messageId"));
        assertEquals("conv-456", body.get("conversationId"));
        assertEquals("这是一个测试回复", body.get("answer"));

        // 验证服务层方法被调用
        verify(difyChatFlowService, times(1)).sendMessage(message, userId, null);
    }

    @Test
    void testSendMessage_Failure() {
        // 准备测试数据
        String message = "你好";
        String userId = "user-123";
        Map<String, String> request = new HashMap<>();
        request.put("message", message);
        request.put("userId", userId);

        // 模拟服务层抛出异常
        when(difyChatFlowService.sendMessage(message, userId, null))
                .thenThrow(new RuntimeException("API 调用失败"));

        // 执行测试
        ResponseEntity<Map<String, Object>> response = chatController.sendMessage(request);

        log.info("结果：{}", response);

        // 验证结果
        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response.getStatusCode());
        assertNotNull(response.getBody());

        Map<String, Object> body = response.getBody();
        assertNotNull(body);
        assertEquals("API 调用失败", body.get("error"));

        // 验证服务层方法被调用
        verify(difyChatFlowService, times(1)).sendMessage(message, userId, null);
    }

    @Test
    void testGetConversations_Success() {
        // 准备测试数据
        String userId = "user-123";
        Integer limit = 20;
        ConversationListResponse conversationListResponse = ConversationListResponse.builder()
                .data(Collections.singletonList(mockConversation))
                .hasMore(false)
                .limit(limit)
                .build();

        // 模拟服务层方法
        when(difyChatFlowService.getConversations(userId, limit)).thenReturn(conversationListResponse);

        // 执行测试
        ResponseEntity<Map<String, Object>> response = chatController.getConversations(userId, limit);

        // 验证结果
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());

        Map<String, Object> body = response.getBody();
        assertNotNull(body);
        assertTrue((Boolean) body.get("success"));
        assertEquals(Collections.singletonList(mockConversation), body.get("data"));

        // 验证服务层方法被调用
        verify(difyChatFlowService, times(1)).getConversations(userId, limit);
    }

}