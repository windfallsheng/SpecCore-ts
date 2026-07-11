#!/usr/bin/env python3
"""
宪法生成脚本 — 基于 scan-project.py 的 JSON 输出，生成 CONSTITUTION.md 初稿。

用法:
    python3 scan-project.py [项目目录] | python3 generate-constitution.py

或:
    python3 scan-project.py > scan_result.json
    python3 generate-constitution.py scan_result.json
"""

import json
import sys
from datetime import datetime
from typing import Dict, Any


def format_date() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def generate(scan_result: Dict[str, Any]) -> str:
    """基于扫描结果生成 CONSTITUTION.md 内容。"""

    lines = [
        "# 项目全局宪法 (Global Constitution)",
        "",
        f"> ⚠️ 本文件由 `/mysdd-init --mode=migration` 基于代码扫描自动生成。",
        f"> 扫描时间: {scan_result.get('scan_time', 'unknown')}",
        f"> 请人工审查并补充 `[待补充]` 标记的项。",
        "",
        "---",
        "",
        "## 1. 技术栈（自动检测）",
        "",
    ]

    # ---- 后端技术栈 ----
    tech = scan_result.get("tech_stack", {})
    java = tech.get("java", {})

    if java:
        lines.append("### 后端")
        lines.append("")
        lines.append("| 类别 | 技术选型 | 检测来源 |")
        lines.append("| :--- | :--- | :--- |")

        if java.get("java"):
            lines.append(f"| JDK | Java {java['java']} | pom.xml / build.gradle |")
        if java.get("spring-boot"):
            lines.append(f"| 框架 | Spring Boot {java['spring-boot']} | pom.xml parent |")
        if java.get("mybatis-plus"):
            lines.append(f"| ORM | MyBatis-Plus {java['mybatis-plus']} | pom.xml dependency |")
        if java.get("mysql"):
            lines.append(f"| 数据库 | MySQL | pom.xml dependency |")
        if java.get("postgresql"):
            lines.append(f"| 数据库 | PostgreSQL | pom.xml dependency |")
        if java.get("redis"):
            lines.append(f"| 缓存 | Redis | pom.xml dependency |")
        if java.get("jjwt"):
            lines.append(f"| JWT | jjwt {java['jjwt']} | pom.xml dependency |")
        if java.get("springdoc"):
            lines.append(f"| API 文档 | SpringDoc OpenAPI | pom.xml dependency |")

        lines.append("")

    # ---- 前端技术栈 ----
    fe = tech.get("frontend", {})

    if fe:
        lines.append("### 前端")
        lines.append("")
        lines.append("| 类别 | 技术选型 | 检测来源 |")
        lines.append("| :--- | :--- | :--- |")

        if fe.get("vue"):
            lines.append(f"| 框架 | Vue {fe['vue']} | package.json |")
        if fe.get("react"):
            lines.append(f"| 框架 | React {fe['react']} | package.json |")
        if fe.get("ui-web"):
            lines.append(f"| Web UI 库 | {fe['ui-web']} | package.json |")
        if fe.get("ui-h5"):
            lines.append(f"| H5 UI 库 | {fe['ui-h5']} | package.json |")
        if fe.get("bundler"):
            lines.append(f"| 构建工具 | {fe['bundler']} | package.json |")
        if fe.get("typescript"):
            lines.append(f"| TypeScript | {fe['typescript']} | package.json |")
        if fe.get("charts"):
            lines.append(f"| 图表库 | {fe['charts']} | package.json |")

        lines.append("")

    # 如果没有任何技术栈检测到
    if not java and not fe:
        lines.append("> ⚠️ 未检测到 pombuild.gradle 或 package.json，请手动填写。")
        lines.append("")
        lines.append("| 层 | 技术 | 版本 |")
        lines.append("| :--- | :--- | :--- |")
        lines.append("| 后端框架 | [待补充] | [待补充] |")
        lines.append("| 前端框架 | [待补充] | [待补充] |")
        lines.append("")

    # ---- 命名规范 ----
    lines.extend([
        "## 2. 命名规范",
        "",
        "> ⚠️ 以下为 SDD 标准规范，请根据项目实际情况调整。",
        "",
        "- **Java 类**: 驼峰命名（`XxxController`、`XxxServiceImpl`）",
        "- **数据库表**: 小写 + 下划线（`sys_user`、`meeting_room`）",
        "- **接口路径**: `/api/v1/{资源复数}`（如 `/api/v1/bookings`）",
        "- **前端组件**: PascalCase（`BookingForm.vue`）",
        "",
    ])

    # ---- 异常码区间 ----
    lines.extend([
        "## 3. 异常码区间",
        "",
        "| 区间 | 含义 |",
        "| :--- | :--- |",
        "| 1000-1999 | 参数校验错误 |",
        "| 2000-2999 | 认证授权错误 |",
        "| 3000-3999 | 业务逻辑冲突 |",
        "| 5000-5999 | 系统内部错误 |",
        "",
    ])

    # ---- Controller 扫描结果 ----
    controllers = scan_result.get("controllers", [])
    if controllers:
        lines.extend([
            "## 4. 识别到的 API 路径模式",
            "",
            "> 以下为代码扫描发现的 Controller，可作为 Feature 划分参考。",
            "",
        ])
        for ctrl in controllers:
            lines.append(f"### `{ctrl['base_path']}`（{ctrl.get('description', '无描述')}）")
            lines.append("")
            for method in ctrl.get("methods", []):
                lines.append(
                    f"- `{method['http_method']}` {method['full_path']}")
            lines.append("")

    # ---- 建议的 Feature 拆分 ----
    features = scan_result.get("suggested_features", [])
    if features:
        lines.extend([
            "## 5. AI 建议的 Feature 拆分",
            "",
            "> ⚠️ 以下为基于 Controller 扫描的自动建议，请人工审查确认。",
            "",
            "| 建议 Feature | 名称 | 路径前缀 | 端点数量 |",
            "| :--- | :--- | :--- | :--- |",
        ])
        for f in features:
            lines.append(
                f"| {f['suggested_id']} | {f['name']} | {f['base_path']} | {f['endpoint_count']} |"
            )
        lines.append("")

    # ---- 强制约束 ----
    lines.extend([
        "## 6. 强制约束",
        "",
        "- ✅ 所有接口 `@Operation` 注解 + 统一返回 `Result<T>`",
        "- ✅ 所有写操作 `@Transactional`",
        "- ✅ 前端所有 API 调用 `try-catch` + 错误提示",
        "- ✅ 遵守 `RULES/conflict-resolution.md` 冲突裁决规则",
        "- ✅ 本宪法修改需经架构评审",
        "",
    ])

    # ---- 配置文件摘要 ----
    configs = scan_result.get("configs", {})
    if configs:
        lines.extend([
            "## 7. 检测到的配置文件",
            "",
        ])
        for path, content in configs.items():
            lines.extend([
                f"### `{path}`",
                "```yaml",
                content,
                "```",
                "",
            ])

    # ---- 变更履历 ----
    lines.extend([
        "---",
        "",
        "| 版本 | 日期 | 变更说明 |",
        "| :--- | :--- | :--- |",
        f"| v1.0 | {format_date()} | /mysdd-init --mode=migration 自动生成 |",    ])

    return "\n".join(lines)


if __name__ == "__main__":
    # 从 stdin 或文件读取扫描结果
    if len(sys.argv) > 1:
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)

    constitution = generate(data)
    print(constitution)

    # 同时保存到文件
    output_path = ".ai/CONSTITUTION.md"
    try:
        import os
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(constitution)
        print(f"\n✅ 已保存到 {output_path}", file=sys.stderr)
    except OSError as e:
        print(f"\n⚠️ 无法保存文件: {e}", file=sys.stderr)
        print("请手动将以上内容保存到 .ai/CONSTITUTION.md", file=sys.stderr)
