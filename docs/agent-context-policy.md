## Sol / Luna Context 管理清单

### 角色定义

* Sol = 长期 Coordinator
* Luna = Ticket-scoped 一次性 Worker
* Repo = 长期记忆
* Conversation = 临时工作区

### Sol 长期保留

* 当前 Milestone / Active Ticket
* Authoritative Constraints
* Unresolved Blockers
* 当前 Interfaces / Schemas / Invariants
* 已完成 Ticket 的 Compact Handoff
* 剩余 Tickets 的 Dependency State

### 分发 Luna

仅提供：

* Ticket Goal
* Acceptance Criteria
* 必要 Dependencies
* 关键 Constraints
* 相关 Authoritative Files 路径

执行规则：

* 让 Luna 自行读取 Repo
* 不复制大段历史 Conversation
* 不传递无关的已完成 Ticket 细节

### Luna 完成后仅回传

* Completion Status
* Key Files Changed
* Interfaces / Schemas / Invariants Changed
* Validation / Acceptance Results
* Unresolved Issues / Blockers
* Downstream Consequences

### Ticket 收尾压缩

Sol 接收 Compact Handoff 后，压缩或丢弃所有 downstream 不再需要、且可从 Repo / Git 恢复的过程性信息，包括：

* Luna 完整执行过程
* 已解决的 Debugging
* Failed Approaches
* 长 Terminal / Test Logs
* 临时代码与低层实现细节
* 已冻结决策的重复讨论

### Context Budget

* <40%：正常执行
* 40–50%：开始减少历史累积
* ≈50%：主动 Compact
* 50–55%：开始大型 Ticket 前先 Compact
* 60%：Soft Limit，不是目标

### 永远保留

* Active Requirements
* Milestone Acceptance Conditions
* Unresolved Blockers
* 当前 Contracts
* Downstream 仍依赖的 Acceptance Results
* 尚未落盘的重要事实

### 核心原则

* Compact Implementation History
* 保留 Authoritative State
* Repo 优先于 Conversation Memory

### 目标

Sol Context = 当前项目状态 + 当前执行前沿 + Compact Handoffs

不要让 Sol 变成所有 Luna Worker 执行历史的累积仓库。
