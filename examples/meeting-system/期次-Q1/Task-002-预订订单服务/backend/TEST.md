# 测试大纲: Task-002 预订订单服务

## 单元测试

### BookingServiceTest

```java
@Test public void createBooking_无冲突_返回BookingVO()
@Test public void createBooking_完全重叠_抛出BusinessException(2001)
@Test public void createBooking_部分重叠_抛出BusinessException(2001)
@Test public void createBooking_接壤不重叠_正常创建() // 10:00结束,10:00开始→不冲突
@Test public void createBooking_过去日期_抛出BusinessException(2003)
@Test public void createBooking_会议室不存在_抛出BusinessException(1001)
@Test public void listMyBookings_分页查询_返回当前用户预订()
@Test public void listMyBookings_按日期筛选()
@Test public void listMyBookings_按状态筛选()
@Test public void getBooking_存在_返回详情含会议室名称()
@Test public void getBooking_不存在_抛出BusinessException(2002)
@Test public void cancelBooking_正常取消_status=1()
@Test public void cancelBooking_已取消_抛出BusinessException(2002)
@Test public void checkConflict_无冲突_hasConflict=false()
@Test public void checkConflict_有冲突_hasConflict=true+detail()

// 并发测试
@Test public void concurrentBooking_同时预订_只有一条成功()
```

## 集成测试

```java
@Test public void api_CreateBooking_200()
@Test public void api_CreateBooking_Conflict_409()
@Test public void api_CheckConflict_200()
@Test public void api_CancelBooking_200()
```

## 覆盖率
- 行 > 80% · 分支 > 70% · 冲突检测 4 场景 100%
