# /spec-ask — 自然语言智能入口

用户无需记命令，直接用自然语言描述需求，AI 自动理解并调用对应 SpecCore 命令。

## 三种方式

### 1. 直接输入（最简单）
```
帮我创建一个用户登录功能
查看项目进度
修复支付回调超时的问题
把登录改成验证码登录
```

### 2. 显式 `/spec-ask` 命令
```
/spec-ask "分析当前需求"
/spec-ask "拆分任务"
```

### 3. CLI 命令
```bash
speccore ask "创建登录功能"
speccore "分析需求"          # 省略 ask，直接说人话
```

## 支持的话术
- 创建类: "帮我创建一个XX功能" → task new
- 查询类: "查看进度" "看一下状态" → status-panel
- 执行类: "开始开发" "执行开发任务" → execute
- 变更类: "把XX改成YY" → change
- Bug类: "修复XX问题" → bugfix
- 分析类: "分析需求" → analyze
- 拆分: "拆成任务" → iteration split
