# ═══════════════════════════════════════════════════════════
# Spring Boot Docker 构建示例
# ═══════════════════════════════════════════════════════════
#
# 用法：
#   1. 将本文件复制到 Java 工程根目录（与 pom.xml 同级）
#   2. 在 PROJECT.yaml 中配置 docker 类型部署：
#      deploy:
#        staging:
#          type: docker
#          dockerfile: ./Dockerfile
#          registry: registry.example.com
#          image: my-project/order-service
#          tag: staging
#   3. 执行: speccore deploy --env staging --platform order-service
#
# 多阶段构建：先编译，再复制 jar 到精简镜像
# ═══════════════════════════════════════════════════════════

# ── 阶段 1：构建 ──
FROM maven:3.9-eclipse-temurin-17-alpine AS builder
WORKDIR /build
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests -P docker

# ── 阶段 2：运行 ──
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app

# 创建非 root 用户（安全最佳实践）
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# 复制构建产物
COPY --from=builder /build/target/*.jar app.jar

# 环境变量（可在运行时通过 -e 覆盖）
ENV SPRING_PROFILES_ACTIVE=staging
ENV JAVA_OPTS="-Xms512m -Xmx1024m -Dfile.encoding=UTF-8 -Djava.security.egd=file:/dev/./urandom"

# 暴露端口（根据实际应用修改）
EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/actuator/health || exit 1

USER appuser

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
