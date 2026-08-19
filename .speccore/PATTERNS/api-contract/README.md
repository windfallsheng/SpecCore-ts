# api-contract — API 契约模式

跨端通用的 API 设计模式。涵盖接口规范、错误码体系、响应格式、版本策略等。

## 何时沉淀

- 发现统一的分页响应格式
- 发现标准的错误码包装方式
- 发现接口版本控制策略
- 发现统一的请求校验模式

## 示例模式

| 模式名 | 说明 |
|:---|:---|
| pagination-response | 统一分页响应格式（page/size/total/items） |
| error-code-wrapper | 标准错误响应包装（code/message/data） |
| api-versioning | 接口版本控制策略（URL/Header/Media Type） |
