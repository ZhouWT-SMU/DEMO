package edu.smu.agent.controller;

import java.util.List;
import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import edu.smu.agent.service.AuthService;
import edu.smu.agent.service.CapabilitySubmissionService;
import edu.smu.agent.service.CapabilitySubmissionService.Status;
import edu.smu.agent.service.CapabilitySubmissionService.Submission;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/capability")
@RequiredArgsConstructor
public class CapabilityController {

    private final CapabilitySubmissionService submissionService;
    private final AuthService authService;

    @PostMapping("/submit")
    public ResponseEntity<Map<String, Object>> submit(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-Auth-Token", required = false) String token) {

        AuthService.Session session = authService.validate(token);
        if (session == null || !"ENTERPRISE".equalsIgnoreCase(session.role())) {
            return ResponseEntity.status(401).body(Map.of(
                    "success", false,
                    "message", "请使用企业账号登录后再提交能力信息"
            ));
        }

        Submission submission = submissionService.createSubmission(body, session.displayName(), session.username());
        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "提交成功，待管理员审核",
                "submission", submission
        ));
    }

    @GetMapping("/submissions")
    public ResponseEntity<?> listSubmissions(@RequestHeader(value = "X-Auth-Token", required = false) String token) {
        AuthService.Session session = authService.validate(token);
        if (session == null || !"ADMIN".equalsIgnoreCase(session.role())) {
            return ResponseEntity.status(401).body(Map.of("message", "仅管理员可查看审批列表"));
        }
        return ResponseEntity.ok(submissionService.listSubmissions());
    }

    @GetMapping("/my-submissions")
    public ResponseEntity<?> listMySubmissions(@RequestHeader(value = "X-Auth-Token", required = false) String token) {
        AuthService.Session session = authService.validate(token);
        if (session == null || !"ENTERPRISE".equalsIgnoreCase(session.role())) {
            return ResponseEntity.status(401).body(Map.of("message", "请使用企业账号登录后再查看历史记录"));
        }
        return ResponseEntity.ok(submissionService.listSubmissionsByUser(session.username()));
    }

    @GetMapping("/submissions/{id}")
    public ResponseEntity<?> getSubmission(@PathVariable String id,
                                           @RequestHeader(value = "X-Auth-Token", required = false) String token) {
        AuthService.Session session = authService.validate(token);
        if (session == null || !"ADMIN".equalsIgnoreCase(session.role())) {
            return ResponseEntity.status(401).body(Map.of("message", "仅管理员可查看详情"));
        }
        Submission submission = submissionService.getSubmission(id);
        if (submission == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(submission);
    }

    @PostMapping("/submissions/{id}/decision")
    public ResponseEntity<?> decide(
            @PathVariable String id,
            @RequestBody Map<String, String> body,
            @RequestHeader(value = "X-Auth-Token", required = false) String token) {
        AuthService.Session session = authService.validate(token);
        if (session == null || !"ADMIN".equalsIgnoreCase(session.role())) {
            return ResponseEntity.status(401).body(Map.of("message", "仅管理员可进行审批"));
        }

        String decision = body.get("decision");
        String remark = body.getOrDefault("remark", "");

        Status status;
        if ("approve".equalsIgnoreCase(decision)) {
            status = Status.APPROVED;
        } else if ("reject".equalsIgnoreCase(decision)) {
            status = Status.REJECTED;
        } else {
            return ResponseEntity.badRequest().body(Map.of("message", "决策参数错误"));
        }

        Submission updated = submissionService.decide(id, status, remark);
        if (updated == null) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(Map.of(
                "success", true,
                "submission", updated
        ));
    }
}