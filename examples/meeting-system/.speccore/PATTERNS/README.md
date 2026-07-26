# 模式库

> 可复用的代码模式和设计范式，从各 Task 的踩坑记录中提炼。

---

## 模式: 时间冲突检测

**来源**: Task-002 踩坑记录

**核心公式**: `(start1 < end2) AND (end1 > start2)`

```java
// MyBatis-Plus 条件构造
LambdaQueryWrapper<Booking> wrapper = new LambdaQueryWrapper<>();
wrapper.eq(Booking::getRoomId, roomId)
       .eq(Booking::getDate, date)
       .lt(Booking::getStartTime, endTime)
       .gt(Booking::getEndTime, startTime)
       .eq(Booking::getStatus, 0);  // 只查有效预订
```

**适用场景**: 任何时间段不可重叠的业务（会议室预订、排班、课程表）

---

## 模式: 统一异常处理

**来源**: CONSTITUTION.md

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(BusinessException.class)
    public Result<Void> handleBusiness(BusinessException e) {
        return Result.fail(e.getCode(), e.getMessage());
    }
    
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public Result<Void> handleValidation(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
            .map(f -> f.getField() + ": " + f.getDefaultMessage())
            .collect(Collectors.joining("; "));
        return Result.fail(4001, msg);
    }
}
```

**适用场景**: 所有 Spring Boot 项目

---

## 模式: 逻辑删除 + 缓存一致性

**来源**: Task-001 踩坑记录

原则: **写操作后主动失效，读操作按需重建。**

```java
@Service
public class RoomServiceImpl implements RoomService {
    public void create(CreateRoomDTO dto) {
        roomRepository.insert(entity);
        redisTemplate.delete("rooms:list:*"); // 清除列表缓存
    }
    
    public void delete(Long id) {
        roomRepository.deleteById(id); // @TableLogic 自动软删除
        redisTemplate.delete("rooms:list:*");
        redisTemplate.delete("rooms:detail:" + id);
    }
}
```

**适用场景**: 缓存 + 逻辑删除的场景
