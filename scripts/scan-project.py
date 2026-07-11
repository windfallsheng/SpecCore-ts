#!/usr/bin/env python3
"""
项目扫描脚本 — 为 /mysdd-init --mode=migration 提供结构化代码分析数据。

用法:
    python3 scan-project.py [项目根目录]

输出: JSON 格式的扫描结果，供 AI 读取后生成 CONSTITUTION.md 等文件。
"""

import os
import re
import json
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Any


class ProjectScanner:
    """扫描项目代码，提取技术栈、API 路径、包结构等信息。"""

    def __init__(self, root_path: str):
        self.root = Path(root_path).resolve()
        self.result: Dict[str, Any] = {
            "project_root": str(self.root),
            "scan_time": datetime.now().isoformat(),
            "project_type": "unknown",
            "tech_stack": {},
            "controllers": [],
            "package_structure": [],
            "configs": {},
            "suggested_features": [],
        }

    # ---- 技术栈扫描 ----

    def scan_java_maven(self) -> Optional[Dict[str, str]]:
        """扫描 pom.xml（Maven 项目），提取依赖信息。"""
        pom_path = self.root / "pom.xml"
        if not pom_path.exists():
            return None

        content = pom_path.read_text(encoding="utf-8")
        deps: Dict[str, str] = {}

        # 提取 Spring Boot 版本（parent）
        m = re.search(r"<parent>.*?<artifactId>spring-boot-starter-parent</artifactId>.*?<version>([^<]+)</version>.*?</parent>",
                      content, re.DOTALL)
        if m:
            deps["spring-boot"] = m.group(1)

        # 提取关键依赖
        dep_pattern = re.compile(
            r"<dependency>\s*<groupId>([^<]+)</groupId>\s*<artifactId>([^<]+)</artifactId>\s*(?:<version>([^<]+)</version>)?",
            re.DOTALL
        )
        for m in dep_pattern.finditer(content):
            artifact = m.group(2)
            version = m.group(3) or "(managed)"
            if "mybatis-plus" in artifact:
                deps["mybatis-plus"] = version
            elif "mysql-connector" in artifact:
                deps["mysql"] = version
            elif "postgresql" in artifact:
                deps["postgresql"] = version
            elif "spring-boot-starter-data-redis" in artifact:
                deps["redis"] = "spring-boot-starter-data-redis"
            elif artifact == "jjwt-api":
                deps["jjwt"] = version
            elif "springdoc-openapi" in artifact:
                deps["springdoc"] = version

        # Java 版本
        m = re.search(r"<java\.version>([^<]+)</java\.version>", content)
        if m:
            deps["java"] = m.group(1)
        m = re.search(r"<maven\.compiler\.source>([^<]+)</maven\.compiler\.source>", content)
        if m:
            deps["java"] = m.group(1)

        self.result["project_type"] = "java-maven"
        return deps

    def scan_java_gradle(self) -> Optional[Dict[str, str]]:
        """扫描 build.gradle（Gradle 项目）。"""
        gradle_path = self.root / "build.gradle"
        if not gradle_path.exists():
            gradle_path = self.root / "build.gradle.kts"
        if not gradle_path.exists():
            return None

        content = gradle_path.read_text(encoding="utf-8")
        deps: Dict[str, str] = {}

        # 提取依赖行
        for line in content.split("\n"):
            line = line.strip()
            if "spring-boot" in line.lower():
                m = re.search(r"['\"]([^'\"]+)['\"]", line)
                if m:
                    deps["spring-boot"] = m.group(1)
            elif "mybatis-plus" in line:
                m = re.search(r"['\"]([^'\"]+)['\"]", line)
                if m:
                    deps["mybatis-plus"] = m.group(1)

        self.result["project_type"] = "java-gradle"
        return deps

    def scan_frontend(self) -> Optional[Dict[str, str]]:
        """扫描 package.json（前端项目）。"""
        pkg_path = self.root / "package.json"
        if not pkg_path.exists():
            return None

        data = json.loads(pkg_path.read_text(encoding="utf-8"))
        all_deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}

        deps: Dict[str, str] = {}
        for dep, version in all_deps.items():
            dl = dep.lower()
            if "vue" in dl and "vue-router" not in dl and "vuex" not in dl and "pinia" not in dl:
                deps["vue"] = version
            elif "react" in dl and "react-" not in dl:
                deps["react"] = version
            elif "element-plus" in dl:
                deps["ui-web"] = "element-plus"
            elif "vant" in dl:
                deps["ui-h5"] = "vant"
            elif "ant-design" in dl or "antd" in dl:
                deps["ui-web"] = "ant-design"
            elif "vite" in dl:
                deps["bundler"] = "vite"
            elif "typescript" in dl:
                deps["typescript"] = version
            elif "echarts" in dl:
                deps["charts"] = "echarts"

        if "vue" in deps or "react" in deps:
            if self.result["project_type"] == "unknown":
                self.result["project_type"] = "frontend"

        return deps

    # ---- Controller 扫描 ----

    def scan_controllers(self) -> List[Dict[str, Any]]:
        """扫描所有 *Controller.java 文件，提取 API 路径和方法。"""
        controllers = []
        for java_file in self.root.rglob("*Controller.java"):
            if "target" in str(java_file) or "test" in str(java_file):
                continue

            content = java_file.read_text(encoding="utf-8")

            # 提取 @RequestMapping 或 @RestController 注解中的基础路径
            base_path = ""
            mapping_match = re.search(
                r'@(?:Request)?Mapping\s*\(\s*(?:value\s*=\s*)?["\']([^"\']+)["\']', content)
            if mapping_match:
                base_path = mapping_match.group(1)

            # 提取方法级映射
            methods = []
            for method_match in re.finditer(
                r'@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\s*\(\s*(?:value\s*=\s*)?["\']([^"\']*)["\']',
                content
            ):
                methods.append({
                    "http_method": method_match.group(1).replace("Mapping", "").upper(),
                    "path": method_match.group(2),
                    "full_path": base_path.rstrip("/") + "/" + method_match.group(2).lstrip("/"),
                })

            if methods:
                # 尝试提取类注释
                class_comment = ""
                comment_match = re.search(r'/\*\*\s*\n\s*\*\s*(.+?)\s*\n', content)
                if comment_match:
                    class_comment = comment_match.group(1)

                controllers.append({
                    "file": str(java_file.relative_to(self.root)),
                    "base_path": base_path,
                    "description": class_comment,
                    "methods": methods,
                })

        return controllers

    # ---- 包结构扫描 ----

    def scan_package_structure(self) -> List[str]:
        """扫描 src/main/java 下的包结构，按层级返回。"""
        packages = set()
        src_dir = self.root / "src" / "main" / "java"
        if not src_dir.exists():
            return []

        for java_file in src_dir.rglob("*.java"):
            rel = java_file.relative_to(src_dir)
            parts = rel.parts
            # 取到 controller/service/mapper 层级
            for i in range(2, min(len(parts), 5)):
                pkg = "/".join(parts[:i])
                if pkg.count("/") >= 1:
                    packages.add(pkg)

        return sorted(packages)

    # ---- 配置文件扫描 ----

    def scan_configs(self) -> Dict[str, str]:
        """扫描 application.yml/application.properties。"""
        configs = {}
        for pattern in ["**/application*.yml", "**/application*.yaml", "**/application*.properties"]:
            for config_file in self.root.glob(pattern):
                if "target" in str(config_file) or "node_modules" in str(config_file):
                    continue
                content = config_file.read_text(encoding="utf-8")
                # 截取前 2KB，过滤注释和空行
                lines = [l for l in content.split("\n") if l.strip() and not l.strip().startswith("#")]
                configs[str(config_file.relative_to(self.root))] = "\n".join(lines[:30])

        return configs

    # ---- Feature 建议 ----

    def suggest_features(self, controllers: List[Dict]) -> List[Dict[str, str]]:
        """基于 Controller 扫描结果建议 Feature 划分。"""
        features = []
        for i, ctrl in enumerate(controllers):
            name = ctrl.get("description", "")
            if not name:
                # 从文件名推断
                name = ctrl["file"].split("/")[-1].replace("Controller.java", "")
                # 驼峰转中文（简单版）
                name = re.sub(r"([A-Z])", r" \1", name).strip()

            features.append({
                "suggested_id": f"Feature-{i + 1:03d}",
                "name": name,
                "base_path": ctrl["base_path"],
                "endpoint_count": len(ctrl["methods"]),
            })

        return features

    # ---- 主入口 ----

    def scan(self) -> Dict[str, Any]:
        """执行完整扫描，返回结构化 JSON。"""
        # 技术栈
        java_deps = self.scan_java_maven() or self.scan_java_gradle()
        if java_deps:
            self.result["tech_stack"]["java"] = java_deps

        fe_deps = self.scan_frontend()
        if fe_deps:
            self.result["tech_stack"]["frontend"] = fe_deps

        # Controller
        controllers = self.scan_controllers()
        self.result["controllers"] = controllers

        # 包结构
        self.result["package_structure"] = self.scan_package_structure()

        # 配置文件
        self.result["configs"] = self.scan_configs()

        # 建议的 Feature 划分
        self.result["suggested_features"] = self.suggest_features(controllers)

        return self.result

    def to_json(self) -> str:
        return json.dumps(self.result, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    scanner = ProjectScanner(root)
    result = scanner.scan()

    print(json.dumps(result, indent=2, ensure_ascii=False))

    # 同时生成简单的摘要
    print("\n" + "=" * 60, file=sys.stderr)
    print("📊 扫描摘要", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print(f"  项目类型: {result['project_type']}", file=sys.stderr)
    if result["tech_stack"]:
        print(f"  技术栈: {json.dumps(result['tech_stack'], ensure_ascii=False)}", file=sys.stderr)
    print(f"  Controller: {len(result['controllers'])} 个", file=sys.stderr)
    print(f"  建议 Feature: {len(result['suggested_features'])} 个", file=sys.stderr)
    if result["suggested_features"]:
        for f in result["suggested_features"]:
            print(f"    {f['suggested_id']}: {f['name']} ({f['endpoint_count']} 端点)", file=sys.stderr)
