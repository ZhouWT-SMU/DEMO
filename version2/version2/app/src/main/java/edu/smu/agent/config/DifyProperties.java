package edu.smu.agent.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import lombok.Data;

/**
 * Dify 配置属性类
 */
@Data
@Component
@ConfigurationProperties(prefix = "dify")
public class DifyProperties {

    /**
     * Dify API 基础 URL
     */
    private String baseUrl;

    /**
     * Dify Chatflow API Key
     */
    private String chatflowApiKey;
}