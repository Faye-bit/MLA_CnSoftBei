# 智能体编排器 — 潜在改进方向评估报告

> 评估对象: `backend/app/services/learning/agent_orchestrator.py` 及关联模块
> 评估日期: 2026-06-30
> 评估人: Faye

---

## 一、背景

在梳理完多智能体编排的完整逻辑后, 识别出 4 个潜在改进方向。本文档对各方向按优先级、实现复杂度、改动风险三个维度进行评估并排序, 作为后续迭代的决策参考。

### 评估维度说明

| 维度 | 含义 | 1 分 | 10 分 |
|---|---|---|---|
| **优先级** | 对产品质量 / 用户体验的影响程度 | 几乎无影响 | 核心体验或安全合规问题 |
| **实现复杂度** | 代码量、涉及文件数、需新增的逻辑 | 几行模板复制 | 大规模重构 |
| **改动风险** | 对现有功能破坏的可能性、回滚难度 | 纯增量, 不动现有接口 | 根本性重构, 全量回归 |

---

## 二、分项评估

### 🥇 第 1 位: 资源生成重试机制统一

#### 现状

当前只有 `mindmap` 和 `video_script` 两种资源具备重试逻辑:

| 资源类型 | 重试次数 | 验证机制 |
|---|---|---|
| `handout` | 0 | 无 |
| `mindmap` | 3 | 标题层级验证 (根节点 + 深度 + 节点数) |
| `exercise` | 0 | 无 |
| `reading` | 0 | 无 |
| `coding_practice` | 0 | 无 |
| `video_script` | 1 (完整性重试) | HTML 闭合标签检测 |

`handout` 和 `exercise` 是核心资源 (几乎每个阶段必生成)。一旦 LLM 调用瞬时失败, 学生直接看到:

- 讲义: `"# 操作系统\n\n讲义生成失败: RateLimitError\n\n请稍后重试。"`
- 练习题: `{"questions": []}`

#### 评估

| 维度 | 评分 | 理由 |
|---|---|---|
| 优先级 | **7 / 10** | 核心资源的生成失败直接影响学习体验, 而 LLM API 的瞬时抖动 (限流、超时) 在生产环境中并不罕见 |
| 复杂度 | **2 / 10** | `mindmap` 的 `for attempt in range(3)` 模式可直接复制; `exercise` 额外需要 JSON 结构校验 (非空 questions / 题型合法性), 整体改动 < 80 行, 仅限 `resource_generators.py` |
| 风险 | **1 / 10** | 纯增量修改, 不改变任何现有接口签名; 成功路径完全不变, 失败路径仅多等几秒; 极端情况 (全部重试耗尽) 的降级行为与当前一致 |

#### 建议方案

```
handout:         添加 2 次重试 (LLM 调用异常时, 温度逐步调高)
exercise:        添加 2 次重试 + JSON 结构校验 (questions 非空, 题型合法)
coding_practice: 添加 2 次重试 (LLM 调用异常时)
reading:         添加 2 次重试 (LLM 调用异常时)
```

统一模式:

```python
async def generate_with_retry(generator, max_retries=3, validator=None):
    last_error = None
    for attempt in range(max_retries):
        try:
            result = await generator(temperature=0.3 + attempt * 0.1)
            if validator and not validator(result):
                continue  # 验证失败 → 重试
            return result
        except Exception as e:
            last_error = e
    return fallback_result(last_error)
```

**综合评分: ⭐⭐⭐⭐⭐ — 投入产出比最高, 典型的 low-hanging fruit**

---

### 🥈 第 2 位: Fact Check Agent 接入

#### 现状

- `FACT_CHECK_SYSTEM_PROMPT` 已在 `orchestrator_prompts.py` 中定义完整
- `LearningState` 中 `fact_check_report` 和 `fact_check_passed` 字段已预留
- `AGENT_DISPLAY_NAMES` 和 `AGENT_START_MESSAGES` 中 `fact_check` 条目已注册
- 但在 `_generate_resources_for_stage()` 实际执行路径中 **完全没有调用**

这意味着 LLM 生成的资源 (尤其是 `handout` 中的概念定义、`exercise` 中的参考答案) 直接交付给学生, 未经任何审核。

#### 评估

| 维度 | 评分 | 理由 |
|---|---|---|
| 优先级 | **8 / 10** | 教育场景对事实准确性要求极高。错误的概念定义或参考答案可能误导学生, 这是一个潜在的质量合规问题 |
| 复杂度 | **5 / 10** | System Prompt / 状态字段 / UI 映射已全部就绪, 核心工作在于: ① 在管线中确定插入位置; ② 设计核查失败策略; ③ 实现调用逻辑。预估 150-200 行, 主要改动 `agent_orchestrator.py` |
| 风险 | **4 / 10** | 风险不在破坏现有逻辑, 而在设计不当引入新问题: ① 核查过严 → 大量资源被标记不合格, 阻塞学习流程; ② 核查 LLM 调用增加延迟; ③ LLM 核查本身可能误判 (假阳性) |

#### 插入策略对比

| 策略 | 延迟 | 安全性 | 描述 |
|---|---|---|---|
| **A. 并行核查 (推荐)** | 低 | 中 | 资源全部生成完 → `asyncio.gather` 对每个资源调 Fact Check → 通过则正常返回, 失败在 `resource_metadata` 中标记 `fact_check_failed: true` → 不阻塞返回, 前端可展示"内容审核中" |
| **B. 异步后核查** | 零 (用户无感) | 低 | 资源先生成并立即返回 → 后台任务异步核查 → 结果写回 DB → 前端轮询更新。缺点: 用户可能在核查完成前已阅读错误内容 |
| **C. 同步阻塞核查** | 高 | 最高 | 生成 → 核查 → 不通过则重新生成。缺点: 延迟显著增加, 且 LLM 核查本身不可靠, 可能导致无限重试循环 |

#### 建议方案

采用 **策略 A (并行核查)**:

```python
# 在资源并行生成之后, 持久化之前插入
fact_check_tasks = [
    _fact_check_single(r, stage_title, profile_summary)
    for r in resources
]
checked_resources = await asyncio.gather(*fact_check_tasks)

# 核查不通过的资源仍然保存, 仅在 metadata 中标记
for r in checked_resources:
    if r["fact_check_passed"]:
        logger.info(f"✅ {r['resource_type']} 核查通过")
    else:
        logger.warning(f"⚠️ {r['resource_type']} 核查未通过: {r['fact_check_report']}")
        r["resource_metadata"]["fact_check_failed"] = True
        r["resource_metadata"]["fact_check_report"] = r["fact_check_report"]
```

核查粒度建议:
- **handout**: 检查核心概念定义、关键原理是否与知识库一致
- **exercise**: 检查参考答案是否正确、题目是否有歧义
- **coding_practice**: 检查代码逻辑是否正确、有无安全风险
- **mindmap / reading / video_script**: 低优先级, 可跳过 (内容结构性较弱)

**综合评分: ⭐⭐⭐⭐ — 安全合规, 近期应规划**

---

### 🥉 第 3 位: 伪 Agent 升级为真 LLM Agent

#### 现状

`orchestrator_prompts.py` 中为 Profile / Retrieval / Teaching Design 三个 Agent 定义了完整的 System Prompt:

| Agent | System Prompt | 实际执行 |
|---|---|---|
| Profile Agent | 分析学生画像, 输出 100-200 字自然语言总结 | 直接从 `StudentProfile` 表读取 `profile_data`, 拼接为 `key: value` 文本 |
| Retrieval Agent | 总结知识库检索结果, 输出 150-300 字知识总结 | 直接使用 RAG 原文 (截取前 600 字符), 不做二次加工 |
| Teaching Design Agent | 根据阶段和画像设计资源类型和主题 | 简化为用户配置驱动: 读取 `session_metadata.resource_types` 过滤 |

即这些 Agent 的 System Prompt 虽然已定义, 但**从未被实际调用**。

#### 评估

| 维度 | 评分 | 理由 |
|---|---|---|
| 优先级 | **3 / 10** | 当前的"简化版"实现实际上工作得很好—— Profile 拼接的原文信息量比 LLM 总结更大 (无损); Retrieval 的 RAG 原文比 LLM 二次总结更准确 (无幻觉); Teaching Design 由用户偏好驱动比 LLM 自由发挥更可控。升级的边际收益很低 |
| 复杂度 | **6 / 10** | 需要在 `_generate_resources_for_stage` 中插入 3 个 LLM 调用, 各自解析输出, 处理失败降级。预估 200-300 行, 涉及 `agent_orchestrator.py` 和 `orchestrator_prompts.py` |
| 风险 | **5 / 10** | ① 增加 3 个 LLM 调用 → 首阶段生成延迟从 ~10s 膨胀到 ~30s; ② 每个 LLM 调用都是新的故障点, 增加不稳定因素; ③ Profile 总结可能"过度解读"学生画像, 引入偏见; ④ Retrieval 二次总结可能丢失 RAG 原文中的关键细节 |

#### 建议

**不建议近期实施。** 除非出现以下明确需求信号:
- 用户反馈"画像分析不够智能, 生成内容没有针对我的水平调整"
- RAG 检索返回过多噪音, 需要 LLM 总结提纯
- 需要根据复杂的学生画像动态决策资源类型 (而非简单的配置勾选)

**综合评分: ⭐⭐ — 暂缓, 观察需求**

---

### 4️⃣ 第 4 位: 构建完整的 LangGraph StateGraph

#### 现状

当前只有 `coordinator_node` 是以 LangGraph 节点形式实现的, 其他所有步骤 (检索、画像、生成、核查) 都是普通的 async 函数 + 直接调用。`LearningState` TypedDict 被定义为节点间传递的状态结构, 但实际上更多充当了"配置字典"的角色。

#### 评估

| 维度 | 评分 | 理由 |
|---|---|---|
| 优先级 | **2 / 10** | 当前的直接函数调用方式已经完整实现了编排逻辑。构建 StateGraph 不会改变任何面向用户的行为——它是纯架构层面的重构。LangGraph 的高级特性 (checkpointing、human-in-the-loop、条件分支) 在当前需求中并没有被用到。**没有用户可感知的价值** |
| 复杂度 | **9 / 10** | 需要: ① 将所有节点改为标准 LangGraph node 签名 (状态输入/输出); ② 设计图拓扑 (节点列表、条件边、入口出口); ③ 处理 LangGraph streaming 与现有 SSE 协议的适配; ④ `_safe_stream_writer` 这类补丁代码说明 LangGraph runtime context 问题需要统一解决; ⑤ 全面回归测试所有 SSE 事件路径。预估 500+ 行改动, 覆盖所有 orchestration 文件 |
| 风险 | **8 / 10** | 这是对编排层的**根本性重构**。现有代码经过了幂等安全、并发安全、SSE 事件顺序的精心打磨。重写为 StateGraph 很可能引入: ① SSE 事件顺序变化导致前端显示异常; ② 状态字段传递遗漏; ③ LangGraph checkpoint 机制与数据库持久化的冲突; ④ 现有 `_safe_stream_writer` 补丁说明的 runtime context 问题在更多节点中复现 |

#### 何时值得做

只有当以下需求明确出现时, 构建 StateGraph 才有实际收益:

- **Human-in-the-loop**: 需要在生成过程中暂停等待用户输入 (如"请确认本阶段学习重点")
- **条件分支路由**: 需要根据核查结果决定是重生成、跳过还是人工审核
- **Checkpoint 断点续传**: 需要在长时间生成过程中支持暂停/恢复
- **跨会话状态共享**: 需要在不同学习阶段之间持久化中间状态
- **可视化编排图**: 需要在调试/监控界面展示编排流程的 DAG 拓扑

在以上任何需求出现之前, **保持当前直接函数调用的方式是最务实的选择**。

**综合评分: ⭐ — 远期架构演进, 等待需求驱动**

---

## 三、排序总览

```
  改进项                         优先级  复杂度  风险   综合评分
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 资源生成重试统一             7      2      1      ⭐⭐⭐⭐⭐
2. Fact Check 接入              8      5      4      ⭐⭐⭐⭐
3. 伪 Agent 升级为真 LLM        3      6      5      ⭐⭐
4. LangGraph StateGraph 构建    2      9      8      ⭐
```

### 建议实施路线

| 阶段 | 内容 | 预估工时 | 涉及文件 |
|---|---|---|---|
| **本周** | 资源生成重试统一: handout / exercise / coding_practice / reading 各加 2 次重试 | 2-3 小时 | `resource_generators.py` |
| **下迭代** | Fact Check 接入: 策略 A (并行核查 + metadata 标记, 不阻塞返回) | 1-2 天 | `agent_orchestrator.py`, 新增 `fact_checker.py` |
| **Backlog** | 伪 Agent 升级 — 等待明确的用户反馈驱动 | — | `agent_orchestrator.py` |
| **远期** | LangGraph StateGraph — 等待 conditional routing / checkpointing 需求驱动 | — | 所有 orchestration 文件 |

---

## 四、附录: 代码引用索引

| 组件 | 文件 | 行号 |
|---|---|---|
| 编排主入口 `generate_learning_path_stream` | `agent_orchestrator.py` | 223 |
| Coordinator 节点 `coordinator_node` | `agent_orchestrator.py` | 77 |
| 统一资源生成 `_generate_resources_for_stage` | `agent_orchestrator.py` | 433 |
| 懒加载入口 `generate_next_stage_stream` | `agent_orchestrator.py` | 648 |
| LearningState 定义 | `orchestrator_prompts.py` | 15 |
| Agent System Prompts | `orchestrator_prompts.py` | 60-181 |
| 资源去重持久化 | `orchestrator_utils.py` | 50 |
| 动画链接注入 | `orchestrator_utils.py` | 166 |
| AI 评分子系统 | `orchestrator_utils.py` | 325 |
| 6 种资源生成器 | `resource_generators.py` | 180-687 |
| 资源生成器映射表 `RESOURCE_GENERATORS` | `resource_generators.py` | 714 |
