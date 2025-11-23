package edu.smu.agent.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * 首页控制器
 * 处理根路径请求，返回前端页面
 */
@Controller
public class HomeController {

    /**
     * 处理根路径请求，返回index.html页面
     */
    @GetMapping("/")
    public String home() {
        return "forward:/index.html";
    }
}