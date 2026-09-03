# High-Energy Transient Reading Radar — V0.1 Spec

> **Status: Superseded**  
> Superseded on 2026-09-03 by `V0.1_EXECUTION_SPEC.md` after requirement migration. Retained only as non-normative historical input; do not use it for implementation or acceptance. See `docs/migrations/v0.1-authority-migration.md` for disposition of its requirements.

## 0. 项目目标

构建一个面向课题组内部的高能天体物理文献阅读网站。

网站不是 arXiv 镜像，也不是论文收藏夹。

核心目标是：

* 光球半径约 ￼￼–￼￼ cm，显著大于内吸积盘尺度，支持 reprocessing layer 或 debris envelope。
* 峰值约为 ￼￼；若隐藏的 EUV 占主导，真实总光度可能高于单黑体 UV/optical 估计。
* ￼￼，与宽 Hα 的 ￼￼ 同量级，因此“快速形成大光球”在运动学上并不矛盾。

￼￼￼4. 光谱演化

1. 峰前到近峰期主要是蓝色、近乎无特征的连续谱。

> 把论文组织成“研究问题 → 物理机制 → 方法 → 研究谱系”的知识网络，让组内同学快速判断：什么值得读、为什么值得读、应该先读什么、下一篇读什么。

V0.1 只实现最小可用版本：

1. 静态网站；
2. 论文数据采用 Markdown/MDX + front matter；
3. 支持 Research Lines；
4. 支持 Learning Paths；
5. 支持 Paper Detail；
6. 首页展示精选论文；
7. 先内置约 10–15 篇示例论文；
8. 数据结构必须支持未来扩展到自动 arXiv 推荐。

---

# 1. 非目标

V0.1 不实现：

* 用户登录；
* 收藏；
* 阅读进度；
* 评论；
* 点赞；
* 数据库；
* arXiv 自动抓取；
* ADS API；
* LLM 自动摘要；
* 自动推荐算法；
* 邮件推送；
* 权限管理；
* CMS；
* 后台管理界面；
* graph database；
* 复杂交互式知识图谱。

不要为了“以后可能需要”提前实现这些功能。

---

# 2. 技术栈

优先：

* Astro
* TypeScript
* Markdown / MDX
* Astro Content Collections
* Pagefind
* GitHub Pages 或 Vercel
* GitHub Actions

样式：

* 原生 CSS 或 Tailwind 均可；
* 如果没有明确优势，优先保持简单。

原则：

> static-first, content-first, minimal JavaScript.

---

# 3. 网站信息架构

V0.1 只需要以下页面。

## 3.1 `/`

首页。

展示：

### A. Header

网站名称：

**High-Energy Transient Reading Radar**

副标题：

**Engine-Driven Transients and High-Energy Astrophysics**

导航：

* Today
* Research Map
* Learning Paths
* Papers

---

### B. Today's Must Read

展示最多 3 篇精选论文。

每张卡片：

* title
* year
* authors
* primary research line
* 3–5 个 physics tags
* scientific takeaway
* reading role
* difficulty
* reading time
* “Read paper” 链接

V0.1 不需要真正“每日更新”。

通过 front matter 中：

```yaml
featured: true
```

手工控制。

---

### C. Research Lines

展示 6 个一级研究方向：

1. Central Engines & Engine-powered Transients
2. Relativistic Jets & GRBs
3. Explosive Transients & CSM Interaction
4. Pulsar Winds & High-energy Binaries
5. Magnetar Bursts & FRB Environments
6. Dense-environment & Multi-messenger Transients

每个卡片：

* 名称；
* 一句 physics question；
* 代表性 physics kernels；
* 进入详情页。

---

### D. Learning Paths

首页展示 3–4 条：

* Magnetar-powered Transients
* CSM Interaction
* Jet Propagation
* Pulsar Wind Shocks

---

# 4. Research Line 页面

路由：

```text
/research-lines/[slug]
```

例如：

```text
/research-lines/explosive-transients-csm
```

页面结构：

## Overview

一句核心科学问题。

例如：

> How is kinetic energy in ejecta converted into observable radiation through interaction with circumstellar material?

## Physical Chain

用文本或简单流程图表示：

```text
Ejecta
  ↓
CSM interaction
  ↓
Forward / Reverse shocks
  ↓
Shock heating
  ↓
Radiative diffusion
  ↓
Optical / radio emission
```

不要 V0.1 做复杂 SVG graph。

## Core Physics

展示 physics kernel tags：

* forward shock
* reverse shock
* self-similar dynamics
* radiative diffusion
* shock breakout
* synchrotron

## Core Papers

自动筛选：

```yaml
primary_line: explosive-transients-csm
```

的论文。

排序：

1. foundation
2. group-lineage
3. method
4. frontier
5. opportunity

---

# 5. Learning Path 页面

路由：

```text
/learning-paths/[slug]
```

Learning Path 是 V0.1 最重要的特色之一。

例如：

## CSM Interaction

显示：

```text
Chevalier 1982
↓
Liu et al. 2020
↓
TransFit 2025
↓
TransFit-CSM 2026
↓
Ni et al. 2026
```

每个节点包含：

* paper title
* year
* role
* “what to learn”
* prerequisite
* link

Learning Path 的数据单独存储。

例如：

```yaml
title: CSM Interaction
slug: csm-interaction

description: >
  From self-similar ejecta-CSM dynamics to
  time-dependent radiative inference.

papers:
  - id: chevalier-1982
    learn: "Understand the self-similar FS/RS structure."

  - id: liu-csm-2020
    learn: "Understand parameter scalings and semi-analytic implementation."

  - id: transfit-2025
    learn: "Understand time-dependent radiative diffusion."

  - id: transfit-csm-2026
    learn: "Understand coupled shock evolution and photon escape."

  - id: ni-2026
    learn: "See how the model enters population inference."
```

---

# 6. Paper 页面

路由：

```text
/papers/[slug]
```

Paper 页面是整个网站的核心页面。

## 6.1 Header

展示：

* title
* authors
* year
* journal
* arXiv
* DOI
* primary research line
* reading role
* difficulty
* estimated reading time

外部链接：

* arXiv
* DOI
* ADS（如果提供）

---

## 6.2 Scientific Takeaway

最突出显示。

要求：

> 1–3 句话，不是 abstract 摘要，而是这篇论文真正改变了什么认识。

例如：

> Magnetar heating becomes particularly effective when the spin-down timescale is comparable to the photon diffusion timescale.

---

## 6.3 What problem does it solve?

字段：

```yaml
problem:
```

---

## 6.4 Core assumptions

最多 3–5 条。

例如：

* homologous ejecta
* spherical symmetry
* dipole spin-down
* constant opacity

---

## 6.5 Physical picture

展示一个简单因果链：

```text
Magnetar
↓
Spin-down power
↓
Ejecta heating
↓
Photon diffusion
↓
Optical transient
```

数据字段：

```yaml
physical_chain:
```

---

## 6.6 Key physics

展示：

```yaml
physics_kernel:
```

例如：

* magnetar-spin-down
* radiative-diffusion
* ejecta-dynamics

---

## 6.7 Why this paper matters to the group

字段：

```yaml
group_relevance:
```

允许的用途：

* foundation
* background
* method
* comparison
* constraint
* group-lineage
* new-project

---

## 6.8 What assumption does it replace?

字段：

```yaml
replaces_assumption:
```

如果没有则不显示。

这是重要字段。

例如：

```yaml
replaces_assumption:
  - single representative jet state
```

---

## 6.9 Previous / Next

显示关系：

```yaml
builds_on:
next_read:
```

例如：

```text
Previous:
Chevalier 1982

Next:
TransFit-CSM 2026
```

---

# 7. Paper 数据 Schema

论文存储：

```text
src/content/papers/*.md
```

建议 schema：

```yaml
---
id: kasen-bildsten-2010

title: "Supernova Light Curves Powered by Young Magnetars"

authors:
  - Daniel Kasen
  - Lars Bildsten

year: 2010

journal: "ApJ"

arxiv: "0911.0680"

doi: "10.1088/0004-637X/717/1/245"

ads: ""

primary_line: central-engines

secondary_lines:
  - explosive-transients-csm

phenomenon:
  - SLSN
  - supernova

progenitor:
  - massive-star

engine:
  - magnetar

outflow:
  - sn-ejecta

environment: []

dynamics:
  - homologous-expansion

radiation:
  - thermal
  - radiative-diffusion

messenger:
  - optical

method:
  - analytic
  - semi-analytic

physics_kernel:
  - magnetar-spin-down
  - radiative-diffusion

reading_role:
  - foundation

primary_role: foundation

difficulty: 3

reading_time: 30

featured: true

scientific_takeaway: >
  Magnetar spin-down can power superluminous optical transients,
  with the observed light curve controlled primarily by the
  competition between the spin-down and photon-diffusion timescales.

problem: >
  Can rotational energy from a newly born magnetar power
  optical supernovae brighter than radioactive heating alone?

assumptions:
  - homologous ejecta expansion
  - magnetic dipole spin-down
  - approximately constant opacity
  - efficient thermalization of injected energy

physical_chain:
  - Newly born magnetar
  - Spin-down
  - Energy injection
  - Ejecta heating
  - Photon diffusion
  - Optical transient

group_relevance:
  - foundation
  - background

replaces_assumption: []

builds_on: []

next_read:
  - yu-mergernova-2013

prerequisites:
  - supernova-ejecta
  - radiative-diffusion
  - neutron-star-spin-down
---
```

正文可以包含额外阅读笔记。

---

# 8. Tag Taxonomy

tag 不允许自由无限增加。

V0.1 先维护固定 vocabulary。

## `phenomenon`

```text
GRB
SLSN
FBOT
FXT
FRB
kilonova
supernova
magnetar-burst
gamma-ray-binary
spider-pulsar
```

## `engine`

```text
magnetar
pulsar
black-hole
accretion
radioactive-heating
shock
```

## `environment`

```text
CSM
AGN-disk
stellar-envelope
stellar-wind
Be-disk
magnetosphere
binary-companion
ISM
```

## `dynamics`

```text
forward-shock
reverse-shock
termination-shock
intrabinary-shock
jet-head
jet-collimation
jet-choking
jet-breakout
shock-breakout
homologous-expansion
radiative-diffusion
shock-cooling
```

## `radiation`

```text
synchrotron
inverse-Compton
thermal
SSA
FFA
pp
p-gamma
```

## `messenger`

```text
radio
optical
UV
X-ray
gamma-ray
neutrino
GW
```

## `reading_role`

固定：

```text
foundation
review
method
group-lineage
frontier
opportunity
```

---

# 9. 第一批示例论文

Agent 第一阶段只需要录入以下论文。

不要先录 35 篇。

## Foundation

1. Blandford & McKee 1976
2. Kasen & Bildsten 2010
3. Bromberg et al. 2011
4. Chevalier 1982
5. Weaver et al. 1977

## Group lineage

6. Yu, Zhang & Gao 2013 — merger-nova
7. Yu, Li & Dai 2015 — newborn NS fast transient
8. Liu et al. 2022 — FBOT magnetar population
9. Liu, Wang & Gao 2020 — CSM formalism
10. Chen et al. 2019 — PSR B1259−63
11. Zhang, Zhu & Yu 2024 — GRB jet in AGN disk

## Recent method/frontier

12. TransFit 2025
13. TransFit-CSM 2026
14. Ni et al. 2026 — Ibn/Icn/FBOT
15. Long & Yu 2026 — time-dependent neutrino emission

如果某篇 metadata 无法可靠确认，允许暂时填写：

```yaml
doi: null
```

不要猜 DOI、arXiv 或作者。

---

# 10. Content Collections

建议：

```text
src/content/
├── papers/
│   ├── kasen-bildsten-2010.md
│   ├── yu-mergernova-2013.md
│   └── ...
│
├── research-lines/
│   ├── central-engines.md
│   ├── relativistic-jets.md
│   ├── explosive-transients-csm.md
│   ├── pulsar-binaries.md
│   ├── magnetar-frb.md
│   └── multimessenger-dense-environment.md
│
└── learning-paths/
    ├── magnetar-transients.md
    ├── csm-interaction.md
    ├── jet-propagation.md
    └── pulsar-wind-shocks.md
```

---

# 11. 推荐的代码目录

```text
src/
├── components/
│   ├── Header.astro
│   ├── PaperCard.astro
│   ├── Tag.astro
│   ├── ResearchLineCard.astro
│   ├── LearningPathCard.astro
│   ├── PaperRelation.astro
│   └── PhysicalChain.astro
│
├── layouts/
│   ├── BaseLayout.astro
│   └── PaperLayout.astro
│
├── pages/
│   ├── index.astro
│   ├── papers/
│   │   ├── index.astro
│   │   └── [slug].astro
│   ├── research-lines/
│   │   ├── index.astro
│   │   └── [slug].astro
│   └── learning-paths/
│       ├── index.astro
│       └── [slug].astro
│
├── content/
│
└── styles/
```

---

# 12. UI 原则

网站视觉风格：

* academic
* clean
* information-dense
* low visual noise
* desktop-first but responsive

不要：

* 大量渐变；
* 炫酷动画；
* 卡片阴影泛滥；
* hero 占满首屏；
* dashboard 风格；
* SaaS landing page 风格。

首页第一屏应该直接出现论文。

字体、颜色保持简单。

重点视觉层级：

```text
Paper title
↓
Scientific takeaway
↓
Physics tags
↓
Why read
```

不是：

```text
thumbnail
↓
author avatar
↓
decorative metadata
```

---

# 13. Search

使用 Pagefind。

至少支持搜索：

* paper title
* author
* phenomenon
* physics kernel
* research line

V0.1 不需要 semantic search。

---

# 14. Validation

必须使用 Astro Content Collection schema 做数据验证。

例如：

* `difficulty` 只能 1–5；
* `primary_line` 必须来自固定 enum；
* `reading_role` 必须来自固定 enum；
* `year` 必须是 number；
* `next_read` 必须是 string[]；
* `featured` 必须 boolean。

构建时如果内容格式错误，应直接失败。

---

# 15. V0.1 Acceptance Criteria

完成标准：

### Functional

* `/` 正常显示；
* `/papers` 可以浏览论文；
* `/papers/[slug]` 正常生成；
* `/research-lines` 正常生成；
* `/research-lines/[slug]` 自动筛选相关论文；
* `/learning-paths` 正常生成；
* `/learning-paths/[slug]` 可以显示有序阅读路径；
* Pagefind 可以搜索；
* 所有内部链接有效；
* build 无错误。

### Content

至少：

* 6 个 Research Lines；
* 4 个 Learning Paths；
* 10–15 篇 Paper；
* 每篇 Paper 至少包含：

  * scientific_takeaway
  * problem
  * assumptions
  * physics_kernel
  * group_relevance
  * reading_role

### Quality

* 不重复存储同一篇论文；
* 一个 paper 可以属于多个 secondary lines；
* tag vocabulary 不允许随意增长；
* metadata 缺失时使用 `null`，不猜；
* 页面不依赖客户端 JavaScript 才能读取核心内容。

---

# 16. Agent 第一阶段任务

先不要一次完成整个网站。

第一阶段只完成以下事项：

## Step 1

初始化 Astro + TypeScript 项目。

## Step 2

建立 Content Collections schema：

* papers
* research-lines
* learning-paths

## Step 3

录入：

* 6 个 Research Lines；
* 4 个 Learning Paths；
* 5 篇测试论文。

测试论文：

1. Kasen & Bildsten 2010
2. Yu, Zhang & Gao 2013
3. Liu, Wang & Gao 2020
4. Chen et al. 2019
5. Zhang, Zhu & Yu 2024

## Step 4

只实现：

```text
/
 /papers
 /papers/[slug]
 /research-lines/[slug]
 /learning-paths/[slug]
```

## Step 5

确保 schema、routing、cross-link 正确。

暂时不要优化视觉。

---

# 17. 第一阶段验收

Agent 完成后必须提供：

1. 项目目录树；
2. content schema；
3. 5 篇示例论文 front matter；
4. 6 个 research line 定义；
5. 4 个 learning path 定义；
6. 可以运行的页面；
7. README 中包含：

   * install
   * dev
   * build
   * 如何新增一篇论文
   * 如何新增 learning path

并执行：

```bash
npm install
npm run build
```

确保 build 成功。

---

# 18. 实现原则

遇到不确定性时遵循：

1. 不增加 spec 未要求的功能；
2. 不提前设计数据库；
3. 不提前设计 API；
4. 不提前设计用户系统；
5. 不创造复杂抽象层；
6. 数据 schema 优先于视觉；
7. 页面内容优先于动画；
8. 如果简单静态实现足够，就不要引入客户端状态管理。

V0.1 的目标不是“做一个漂亮的网站”。

目标是验证：

[
\boxed{
\text{Paper}
\leftrightarrow
\text{Physics}
\leftrightarrow
\text{Research Line}
\leftrightarrow
\text{Learning Path}
}
]

这套信息模型是否工作。

如果这一层成立，再做自动 arXiv ingestion 和推荐系统。
