---
appliesTo:
  - react
  - reactjs
priority: 90
---

# React 组件规范

## 组件设计

- **函数组件优先**：所有新组件使用函数组件 + Hooks。
- **单一职责**：一个组件只负责一个功能，超过 200 行必须拆分。
- **Props 接口**：必须定义 `interface Props`，禁止用 `any`。
- **默认导出**：页面级组件默认导出，业务组件命名导出。

## Hooks 规范

- **自定义 Hooks**：复用逻辑必须抽成自定义 Hook，以 `use` 开头。
- **依赖数组**：`useEffect`、`useMemo`、`useCallback` 的依赖数组必须完整。
- **禁止在循环/条件中调用 Hooks**。
- **清理副作用**：`useEffect` 返回清理函数（订阅、定时器、事件监听）。

## 状态管理

- **局部状态优先**：能用 `useState` 就不用全局状态。
- **全局状态**：使用 Context + useReducer 或 Redux/Zustand，禁止 prop drilling 超过 3 层。
- **表单状态**：复杂表单使用 React Hook Form 或 Formik。

## 性能

- **.memo 使用**：仅对纯展示组件且接收复杂 props 时使用。
- **懒加载**：路由级组件使用 `React.lazy()` + `Suspense`。
- **避免内联对象/函数**：作为 props 传递时会导致不必要的重渲染。
