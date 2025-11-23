# JAVA-DIFY

项目目前架构

```css
smu-agent/
├── frontend/
│   ├── index.html          # 聊天界面
│   ├── script.js           # JS逻辑
│   └── styles.css          # CSS样式
├── src/main/java/edu/smu/agent/
│   ├── Application.java              # Spring Boot 启动类
│   ├── controller/
│   │   └── ChatController.java      # 聊天控制器
│   ├── service/
│   │   └── DifyChatFlowService.java # Dify 聊天服务
│   └── config/
│       └── DifyProperties.java      # 简化的配置类
├── src/main/resources/
│   └── application.yml              # 简化的配置文件
└── pom.xml                          # Maven 配置
```

### 🌟使用的JavaClient

[https://github.com/imfangs/dify-java-client](https://github.com/imfangs/dify-java-client)
