package edu.smu.agent.controller;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import edu.smu.agent.service.DifyChatFlowService;
import io.github.imfangs.dify.client.model.chat.ChatMessageResponse;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@SpringBootTest
class DifyRealTest {

    @Autowired
    private DifyChatFlowService difyChatFlowService;

    @Test
    void testRealDifyCall() {
        // 调用 Dify API
        ChatMessageResponse response = difyChatFlowService.sendMessage("你好", "test-user", null);

        // 验证真实响应
        assertNotNull(response.getAnswer());
        assertTrue(response.getAnswer().length() > 0);

        // 使用 SLF4J 日志输出回复内容
        log.info("=== Dify 回复内容 ===");
        log.info("消息ID: {}", response.getMessageId());
        log.info("会话ID: {}", response.getConversationId());
        log.info("回复内容: {}", response.getAnswer());
        log.info("模式: {}", response.getMode());
        log.info("创建时间: {}", response.getCreatedAt());
        log.info("====================");
    }
}