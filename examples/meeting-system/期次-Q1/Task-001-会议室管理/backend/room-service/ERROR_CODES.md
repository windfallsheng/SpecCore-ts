# 错误码定义: Task-001 会议室管理服务

| 错误码 | HTTP 状态 | 含义 | 返回示例 |
| :--- | :--- | :--- | :--- |
| 200 | 200 | 成功 | `{ code:200, message:"success", data:{...} } ` |
| 1001 | 404 | 会议室不存在 | `{ code:1001, message:"会议室不存在" } ` |
| 1002 | 409 | 会议室名称重复 | `{ code:1002, message:"会议室名称已存在: A101" } ` |
| 4001 | 400 | 参数校验失败 | `{ code:4001, message:"name: 不能为空; capacity: 必须为1-200" } ` |
| 5000 | 500 | 系统内部错误 | `{ code:5000, message:"系统繁忙，请稍后重试" } ` |

## 错误码规范

- **区间**: 1000-1999 为会议室管理模块
- **HTTP 状态**: 404(资源不存在)、409(业务冲突)、400(参数错误)、500(系统异常)
- **message**: 中文，面向最终用户，不含技术细节
- **data**: 错误时为 null，成功时为业务数据

## 全局异常映射

```java
RoomNotFoundException(1001)        → 404
RoomDuplicateNameException(1002)  → 409  
ValidationException(4001)         → 400
RuntimeException                   → 500 (5000)
```
