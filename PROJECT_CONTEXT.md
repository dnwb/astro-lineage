# AstroLineage — Project Context

> **Status:** Authoritative product charter  
> **Normative scope:** project purpose, audience, scientific organizing principle, durable product boundaries, and the six Research Line themes.  
> **Delegation:** canonical domain language lives in `CONTEXT.md`; durable trade-off decisions live in `docs/adr/`; the executable V0.1 contract lives in `V0.1_EXECUTION_SPEC.md`. Schema sketches, route examples, counts, technology suggestions, and phase plans below are historical design context rather than competing normative requirements when those delegated sources differ.

## 1. 我们到底要做什么

我们要为高能天体物理课题组建立一个内部科研阅读与知识导航网站。

课题组主要关注高能天体物理中的各类爆发现象，包括但不限于：

* Gamma-Ray Bursts (GRBs)
* Superluminous Supernovae (SLSNe)
* Fast Blue Optical Transients (FBOTs)
* Fast X-ray Transients (FXTs)
* Fast Radio Bursts (FRBs)
* Magnetar bursts
* Kilonovae / compact-object mergers
* Pulsar wind systems
* Gamma-ray binaries
* Explosions and jets embedded in AGN disks
* High-energy neutrino and multi-messenger transients

课题组主要教师包括：

* Yun-Wei Yu（俞云伟）
* Liang-Duan Liu（刘良端）
* A-Ming Chen（陈尚明）

但网站**不能按老师分类成三个 publication list**。

我们的目标是把整个组的研究工作放进统一的物理知识体系中。

---

# 2. 核心科学思想

这个组表面上研究很多不同 transient，但它们背后反复出现的是同一条物理因果链：

```text
Progenitor
    ↓
Central Engine
    ↓
Outflow / Ejecta
    ↓
Environment
    ↓
Interaction / Dynamics
    ↓
Energy Dissipation
    ↓
Radiation / Transport
    ↓
Observable
    ↓
Physical Inference
```

例如：

```text
Newborn magnetar
    ↓
spin-down
    ↓
SN ejecta
    ↓
energy injection
    ↓
radiative diffusion
    ↓
SLSN / FBOT
```

又例如：

```text
GRB engine
    ↓
relativistic jet
    ↓
AGN disk
    ↓
jet-head propagation
    ↓
reverse shock
    ↓
particle acceleration
    ↓
neutrinos
```

又例如：

```text
Pulsar wind
    +
stellar wind / Be disk
    ↓
termination shock
    ↓
synchrotron + inverse Compton
    ↓
X-ray / TeV orbital light curves
```

因此这个网站真正要组织的不是：

```text
GRB
SN
FRB
Pulsar
```

而是：

```text
Energy source
    ↓
Energy transfer
    ↓
Energy dissipation
    ↓
Radiation
    ↓
Observation
```

一句话概括：

> 按天体类别只是目录；按物理因果关系组织才是知识体系。

---

# 3. 网站不是什么

它不是：

* arXiv 镜像；
* ADS 替代品；
* Zotero 替代品；
* publication list；
* 新闻网站；
* AI 摘要网站；
* 单纯的论文搜索引擎。

arXiv 已经很好地回答：

> 今天发表了什么？

我们的网站应该回答另外几个问题：

> 为什么值得读？

> 这篇论文解决了什么真实问题？

> 它依赖哪些核心假设？

> 它在整个研究方向中处于哪里？

> 它改进或者替换了哪个旧假设？

> 读它之前应该先读什么？

> 读完以后下一篇应该读什么？

> 它对我们组当前或者未来的研究有什么用？

因此：

```text
arXiv = timeline

Reading Radar = causal knowledge graph
```

这是项目最核心的产品差异。

---

# 4. 最重要的产品对象：Paper

系统最基本的数据对象仍然是一篇论文。

但 Paper 不能只是：

```text
title
authors
abstract
arXiv
DOI
```

Paper 应该同时是：

```text
bibliographic object
+
physics object
+
research-history node
+
learning-path node
```

也就是说，每篇论文除了 metadata，还应该知道：

```text
它研究什么 phenomenon？
它假设什么 progenitor？
central engine 是什么？
outflow 是什么？
environment 是什么？
有哪些 dynamics？
采用什么 radiation mechanism？
对应什么 messenger？
用了什么 method？
```

更重要的是：

```text
problem
scientific_takeaway
assumptions
physical_chain
physics_kernel
group_relevance
replaces_assumption
builds_on
next_read
prerequisites
```

---

# 5. 网站的六条 Research Lines

第一版采用六条主要研究线。

## R1. Central Engines & Engine-powered Transients

核心问题：

> 爆发现象的能量源是什么，以及中央引擎如何把能量注入 ejecta？

典型物理：

* newborn magnetar
* magnetar spin-down
* pulsar wind nebula
* energy injection
* ejecta acceleration
* radiative diffusion

典型对象：

* SLSN
* FBOT
* GRB
* kilonova
* mergernova
* FXT

---

## R2. Relativistic Jets & GRBs

核心问题：

> Relativistic jet 如何形成、传播、耗散以及最终被不同 viewing angles 的观测者看到？

典型物理：

* relativistic blast wave
* jet structure
* jet head
* cocoon
* collimation
* choking
* breakout
* forward/reverse shocks
* GRB afterglow

---

## R3. Explosive Transients & CSM Interaction

核心问题：

> SN ejecta 的 kinetic energy 如何通过 circumstellar interaction 转化成 radiation？

典型物理：

* ejecta-CSM interaction
* forward shock
* reverse shock
* self-similar dynamics
* shock heating
* shock breakout
* radiative diffusion
* shock cooling
* radio synchrotron
* SSA / FFA

这是当前组内方法发展最完整的一条研究线之一：

```text
Chevalier-like dynamics
    ↓
semi-analytic CSM model
    ↓
time-dependent diffusion
    ↓
shock + diffusion coupling
    ↓
population inference
```

---

## R4. Pulsar Winds & High-energy Binaries

核心问题：

> Relativistic pulsar wind 与 companion environment 相互作用后，如何产生 X-ray / gamma-ray emission？

典型物理：

* pulsar wind
* stellar wind
* Be disk
* termination shock
* intrabinary shock
* synchrotron
* inverse Compton
* orbital modulation
* disk geometry / precession

---

## R5. Magnetar Bursts & FRB Environments

核心问题：

> Magnetar magnetic energy 如何释放，以及 FRB/burst observables 如何反推 magnetosphere 和周围环境？

这里要严格区分：

```text
magnetar rotational energy
```

和

```text
magnetar magnetic energy
```

前者更多属于 R1。

后者属于这里。

典型物理：

* magnetosphere
* magnetic reconnection
* trapped fireball
* magnetar burst
* FRB
* DM
* RM
* Faraday propagation
* binary environment

---

## R6. Dense-environment & Multi-messenger Transients

核心问题：

> 一个 explosion 如果发生在特殊致密环境中，会产生哪些不同于普通 transient 的 observable 和 messenger？

典型环境：

* AGN disk
* dense CSM
* compact-object merger environment

典型现象：

* choked jets
* cocoon breakout
* shock breakout
* embedded GRBs
* neutrino production
* GW/EM/neutrino counterparts

这一栏也是潜在的新课题孵化区。

---

# 6. Research Line 不是严格分类

一个 Paper 可以同时连接多个 Research Lines。

例如：

```text
magnetar + CSM SLSN
```

可以同时连接：

```text
R1 Central Engine
R3 CSM Interaction
```

所以系统不要强迫论文只能属于一个领域。

采用：

```text
primary_line
secondary_lines[]
```

即可。

更细的物理结构通过 multi-axis tags 描述。

---

# 7. Multi-axis Taxonomy

Paper 不应该只有：

```text
topic: supernova
```

而应采用多个独立物理轴：

```text
phenomenon
progenitor
engine
outflow
environment
dynamics
radiation
messenger
method
physics_kernel
```

例如一篇 FBOT radio paper 可以是：

```text
phenomenon:
  FBOT

outflow:
  trans-relativistic-ejecta

environment:
  CSM

dynamics:
  forward-shock

radiation:
  synchrotron
  SSA
  FFA

messenger:
  radio

physics_kernel:
  shock-deceleration
  circumstellar-density
```

这样知识才可以跨天体类别迁移。

---

# 8. 第二个核心对象：Learning Path

Learning Path 是这个网站区别于论文数据库的关键功能之一。

它回答：

> 如果我是刚进入这个方向的研究生，应该按照什么顺序读？

例如：

## CSM Interaction

```text
Chevalier 1982
    ↓
理解 self-similar FS/RS dynamics

Liu et al. 2020
    ↓
理解 parameter scaling 和 semi-analytic implementation

TransFit
    ↓
理解 time-dependent radiative diffusion

TransFit-CSM
    ↓
理解 shock evolution + photon escape coupling

Population study
    ↓
理解如何从单源模型进入 population inference
```

Learning Path 的本质是：

```text
Concept
    ↓
Method
    ↓
Application
    ↓
Current frontier
```

未来至少应该覆盖：

* Magnetar-powered Transients
* CSM Interaction
* Jet Propagation
* Pulsar Wind Shocks

---

# 9. 第三个核心概念：Paper Graph

论文之间不是简单列表，而存在有意义的关系。

允许的核心 edge 包括：

```text
builds_on
extends
generalizes
tests
constrains
applies_to
challenges
replaces_assumption
couples_with
provides_method_for
provides_data_for
motivates
```

尤其重视：

```text
replaces_assumption
```

因为科研进展经常不是“多加一个东西”，而是：

> 去掉了以前一个不可靠的假设。

例如：

```text
single representative state
    ↓ replaced by
full trajectory evolution
```

或者：

```text
fixed diffusion approximation
    ↓
time-dependent photon transport
```

以后 Knowledge Graph 的真正价值主要来自这些 edge，而不是论文数量。

---

# 10. 每篇论文最重要的字段

最重要的不是 abstract。

是：

## scientific_takeaway

1–3 句话回答：

> 这篇论文真正告诉我们什么？

它应该是一个物理判断，而不是摘要压缩。

例如：

```text
Magnetar-powered SN luminosity is controlled largely by the
competition between the spin-down and photon-diffusion timescales.
```

## problem

回答：

> 作者解决的具体 research gap 是什么？

## assumptions

回答：

> 结果成立依赖什么？

## physical_chain

例如：

```text
Magnetar
→ spin-down
→ ejecta heating
→ diffusion
→ optical transient
```

## group_relevance

回答：

> 为什么我们组应该读它？

例如：

```text
foundation
method
comparison
constraint
group-lineage
new-project
```

---

# 11. 首页不是展示整个知识库

首页只解决：

> 今天有什么值得我花时间？

第一版结构：

```text
Today's Must Read
    0–3 papers

Research Lines
    6 lines

Learning Paths
    3–4 paths

Recent / Core Papers
```

论文数量宁缺毋滥。

如果今天没有真正值得读的论文，可以只有 0–1 篇。

以后自动化也不应为了 KPI 强制每天推荐若干篇。

---

# 12. 网站长期内容策略

理想的阅读层次：

```text
Must Read
Worth Knowing
Ignore
```

Must Read：

完整分析：

```text
problem
assumption
scientific takeaway
physics
group relevance
previous / next
```

Worth Knowing：

只做简短介绍。

绝大多数普通 arXiv paper：

不进入主推荐流。

核心原则：

> 推荐系统优化 precision，而不是 recall。

我们不想让学生每天处理几十篇论文。

我们想让学生知道：

> 哪 1–3 篇值得真正投入时间。

---

# 13. Foundation Library

网站不仅追新论文。

必须维护经典理论基础。

例如：

```text
Blandford & McKee
Sari, Piran & Narayan
Chevalier
Weaver
Arnett
Kasen & Bildsten
Bromberg
Dubus
```

因为很多新论文实际上只是这些 physical kernels 在不同参数空间中的应用或扩展。

Foundation paper 的任务是帮助学生形成：

```text
physical picture
scaling relation
regime
limiting case
```

而不是记结论。

---

# 14. Group Lineage

网站还有一个重要任务：

> 保存课题组自己的研究谱系。

不是按照：

```text
Yu papers
Liu papers
Chen papers
```

分三个列表。

而是展示：

```text
一个问题如何在组内连续演化。
```

例如：

```text
magnetar engine
    ↓
mergernova
    ↓
fast transient
    ↓
population inference
    ↓
FBOT/SLSN connection
    ↓
binary engine
    ↓
magnetar + shock
    ↓
magnetar + CSM
```

或者：

```text
CSM interaction
    ↓
semi-analytic formalism
    ↓
TransFit
    ↓
TransFit-CSM
    ↓
population analysis
```

这会让新学生快速理解：

> 我们组以前做过什么，为什么做，现在的问题从哪里来。

---

# 15. 最终我们希望解决的科研阅读问题

对一个学生来说，他面对一篇 paper 时通常有五个层次的问题。

### Level 1

这篇论文讲什么？

普通摘要工具已经能解决。

### Level 2

它解决什么真实问题？

网站应该解决。

### Level 3

它的关键假设是什么？

网站应该解决。

### Level 4

它与此前工作相比真正改变了什么？

Paper Graph 应该解决。

### Level 5

我为什么要读，以及下一步应该读什么？

Learning Path + Group Lineage 应该解决。

我们主要做 Level 2–5。

---

# 16. 技术方向

V0.1：

```text
Astro
TypeScript
Markdown / MDX
Astro Content Collections
Pagefind
GitHub
```

核心原则：

```text
static-first
content-first
minimal JavaScript
```

第一阶段没有数据库。

论文就是：

```text
Markdown + structured front matter
```

这样：

* Git 可以版本控制；
* 人可以直接编辑；
* Agent 可以批量生成；
* 容易 review；
* 以后可以迁移数据库。

---

# 17. 为什么第一阶段不做 AI / arXiv 自动化

因为现在真正需要验证的是：

```text
Paper
↕
Physics
↕
Research Line
↕
Learning Path
```

这套信息模型是否合理。

如果 ontology 不稳定，就直接开始自动抓取 arXiv：

```text
100 papers/day
```

只会制造大量垃圾 metadata。

正确顺序是：

```text
Phase 1
Human-curated knowledge model

Phase 2
High-quality seed library

Phase 3
Automatic arXiv candidate discovery

Phase 4
LLM classification / ranking

Phase 5
Human review / publish

Phase 6
Personalized recommendation
```

---

# 18. 开发路线

## Phase 1 — Skeleton

当前正在做。

目标：

```text
Astro project
Content schema
6 Research Lines
4 Learning Paths
5 test Papers
Basic pages
Cross-linking
Successful build
```

重点：

> 验证数据模型。

不是视觉。

---

## Phase 2 — Seed Knowledge Base

扩展到约：

```text
40–60 high-quality papers
```

组成大致为：

```text
Foundation
+
Group lineage
+
Current frontier
```

每篇都建立：

```text
scientific_takeaway
problem
assumptions
physics_kernel
builds_on
next_read
```

开始形成真正的 Paper Graph。

---

## Phase 3 — Reading Experience

完善：

```text
search
filter
research map
learning paths
paper relations
foundation pages
group lineage
```

此阶段再认真优化 UI。

---

## Phase 4 — arXiv Ingestion

自动读取：

```text
astro-ph.HE/new
astro-ph.HE/recent
```

产生 candidate papers。

注意：

> Candidate ≠ Publish。

---

## Phase 5 — Recommendation Pipeline

未来流程：

```text
arXiv
  ↓
candidate extraction
  ↓
taxonomy classification
  ↓
physics relevance ranking
  ↓
group relevance ranking
  ↓
novelty / actionability evaluation
  ↓
human approval
  ↓
website
```

评分不是简单 keyword similarity。

重点考察：

```text
physics importance
group relevance
novelty
actionability
generality
```

---

## Phase 6 — Personalization

最后才考虑：

```text
individual reading history
personal research interests
saved papers
read/unread
personal recommendation
```

现在完全不做。

---

# 19. Agent 当前应该关注什么

当前 Agent 的工作优先级必须是：

```text
1. Content schema correctness
2. Stable routing
3. Cross-link correctness
4. Content validation
5. Maintainability
6. UI
```

而不是：

```text
1. pretty homepage
2. animation
3. complicated components
4. future-proof architecture
```

如果出现选择：

> 是做一个更漂亮但 schema 很随意的网站，还是做一个很朴素但数据结构正确的网站？

永远选后者。

---

# 20. 当前阶段的成功标准

第一阶段成功并不是：

> 网站看起来像一个正式产品。

而是我们可以顺畅回答：

```text
如何新增一篇论文？

如何把论文挂到两个 Research Lines？

如何告诉系统这篇论文建立在 Chevalier 1982 上？

如何告诉学生读完 A 应该读 B？

如何构建一条 CSM Learning Path？

如何自动列出某个 Research Line 的 Core Papers？
```

如果这些操作自然、简单、稳定：

V0.1 就成功了。

---

# 21. 设计原则

在整个项目中长期遵守：

### Simplicity

没有必要，不增加实体。

### Scientific structure first

科学语义优先于前端结构。

### Human editable

所有核心内容必须容易人工检查和修正。

### Explicit relationships

重要论文之间的关系显式记录，不靠用户猜。

### Controlled vocabulary

Tag 不能无限自由生长。

### Quality over quantity

50 篇认真整理的论文比 5000 篇自动抓取更有价值。

### Agent-friendly

schema 应足够明确，让未来 Agent 可以安全地：

```text
fetch
classify
draft
validate
link
```

但 Agent 不应随意修改 ontology。

---

# 22. 一句话产品定义

如果只能给 Agent 留一句话：

> Build a curated scientific knowledge and reading-navigation system for high-energy transient astrophysics, organized around physical causality and research lineage rather than around paper lists or transient names.

更简洁地说：

> **arXiv 告诉我们“今天有什么”；这个网站告诉我们“为什么值得读，以及它在科学问题中处于哪里”。**

最终目标不是积累论文。

最终目标是积累：

```text
research judgment
+
physical connections
+
research lineage
```

也就是把课题组长期形成的“科研判断力”逐渐变成一个可阅读、可维护、可传承的知识系统。
