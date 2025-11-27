# JAVA-DIFY

本项目为企业能力与审批中心的一体化演示。源代码已移至仓库根目录下的 `app/`，以减少压缩包路径长度，方便在 Windows 上解压。

项目目前架构

```text
app/
├── data/                      # 能力上传与审批记录（本地 JSON 存储）
├── frontend/                  # 聊天/登录页面（静态资源打包时使用）
│   ├── index.html             # 聊天界面
│   ├── script.js              # JS逻辑
│   └── styles.css             # CSS样式
├── src/main/java/edu/smu/agent/
│   ├── Application.java               # Spring Boot 启动类
│   ├── controller/                    # API 控制器
│   ├── service/                       # 业务逻辑
│   └── config/                        # 配置类
├── src/main/resources/
│   ├── application.yml                # 配置文件
│   └── static/                        # 页面静态资源
├── target/                            # 已构建产物
└── pom.xml                            # Maven 配置
```

### 🌟 使用的 Java Client

[https://github.com/imfangs/dify-java-client](https://github.com/imfangs/dify-java-client)
