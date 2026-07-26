# 测试大纲: Task-001 会议室管理服务

> 自动生成 | 基于需求: `00-需求文档/backend需求.md § 会议室管理服务`

## 单元测试

### RoomServiceTest

```java
@Test public void createRoom_正常参数_返回RoomVO()
@Test public void createRoom_名称为空_抛出BusinessException(4001)
@Test public void createRoom_名称重复_抛出BusinessException(1002)
@Test public void createRoom_容量超过200_抛出BusinessException(4001)
@Test public void listRooms_默认分页_返回前十条()
@Test public void listRooms_按楼层筛选_只返回该楼层()
@Test public void listRooms_不包含已删除_verifyLogicDelete()
@Test public void getRoom_存在_返回完整信息()
@Test public void getRoom_不存在_抛出BusinessException(1001)
@Test public void updateRoom_正常修改_返回更新后的VO()
@Test public void updateRoom_不存在_抛出BusinessException(1001)
@Test public void deleteRoom_正常删除_deleted=1()
@Test public void deleteRoom_不存在_抛出BusinessException(1001)
@Test public void deleteRoom_已删除_允许同名新建()
```

## 集成测试

```java
@Test public void api_CreateRoom_200()
@Test public void api_CreateRoom_DuplicateName_409()
@Test public void api_ListRooms_200_WithPagination()
@Test public void api_GetRoom_200()
@Test public void api_GetRoom_NotFound_404()
@Test public void api_UpdateRoom_200()
@Test public void api_DeleteRoom_200()
@Test public void api_DeleteRoom_SoftDeleted()
```

## 覆盖率要求
- 行覆盖率 > 80%
- 分支覆盖率 > 70%
