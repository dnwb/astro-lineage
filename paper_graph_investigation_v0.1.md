# 研究组论文知识图谱与阅读网站：调查结果整理

> **Status: Non-normative investigation evidence**  
> Retained for scientific candidate selection, rationale, and historical context. It does not override `PROJECT_CONTEXT.md`, `CONTEXT.md`, accepted ADRs, or `V0.1_EXECUTION_SPEC.md`, and none of its candidate Scientific Edges is pre-approved.

> 版本：V0.1  
> 日期：2026-09-02  
> 目标：把研究组论文从“文献列表”组织成“物理问题—方法演进—当前前沿”的因果图。

## 1. 核心结论

> **arXiv 是时间轴；这个网站应该是因果图。**

网站最有价值的部分不是收录多少篇论文，而是回答：

1. 这个问题从哪里来？
2. 一篇论文替换了什么旧假设？
3. 它建立在什么工作上？
4. 下一篇应该读什么？
5. 哪些工作可能长出新课题？

因此：

- V1 冻结为 6 条 `Research Line`。
- 一篇论文不能只是 bibliography record，而应同时是：
  - 物理概念节点；
  - 研究历史节点；
  - 学习路径节点。
- V1 不需要几千篇论文，应先做好 35 个高价值节点之间的关系。
- 下一步应进入元数据核验和内容标注，不再无限讨论分类。

## 2. 数量修正

前稿写成了：

$$
24\ \mathrm{Core}+11\ \mathrm{Foundation}=35.
$$

但六栏实际列出的 Core 数量是：

$$
8+4+8+5+4+5=34.
$$

因此应区分“候选池”和“首批上线”：

| 集合 | 数量 | 说明 |
|---|---:|---|
| Core 候选池 | 34 | 前次调查实际列出的组内/相关核心论文 |
| Foundation | 11 | 物理根节点 |
| 候选总池 | 45 | $34+11$ |
| 首批 Core | 24 | 按谱系中心性、物理覆盖和可教学性筛选 |
| 首批 Foundation | 11 | 全部保留 |
| 首批上线 | 35 | $24+11$ |
| 第二轮扩展池 | 10 | 剩余 Core 候选 |

筛选标准不是作者平均分配，也不是 citation 数，而是论文能否成为研究谱系中的转折点或 hub。

## 3. Research Map

| ID | Research Line | Physics kernel | 关键 Hub |
|---|---|---|---|
| R1 | Central Engines & Engine-powered Transients | 转动能注入、magnetar wind、diffusion | newborn magnetar |
| R2 | Relativistic Jets & GRBs | intrinsic jet、jet-medium interaction、viewing geometry | jet propagation |
| R3 | Explosive Transients & CSM Interaction | FS/RS、shock heating、radiative diffusion | shock + diffusion |
| R4 | Pulsar Winds & High-energy Binaries | wind balance、IBS、synchrotron/IC、orbital geometry | structured external flow |
| R5 | Magnetar Bursts & FRB Environments | magnetic energy、magnetosphere、DM/RM、fireball | magnetized environment |
| R6 | Dense-environment & Multi-messenger Transients | AGN-disk propagation、choking/breakout、EM/$\nu$ | trajectory-dependent emission |

### 必须保留的分类边界

R1 主要研究磁星的转动能：

$$
E_{\rm rot}.
$$

R5 主要研究磁场或磁层能量：

$$
E_B.
$$

不能因为两者都出现 `magnetar` 就放入同一目录。

## 4. 三个跨方向 Hub

### 4.1 Newborn magnetar

连接：

`mergernova → SLSN/FBOT → binary engine → PWN shock → FRB progenitor`

### 4.2 Shock / interaction + radiative diffusion

连接：

`CSM interaction → TransFit → TransFit-CSM → TransFit-MAG → population inference`

### 4.3 Outflow + structured environment

连接：

`GRB jet / pulsar wind → AGN disk / Be disk / stellar wind → shock geometry → radiation`

最高层抽象应是：

$$
\boxed{
\text{energy injection}
\rightarrow
\text{flow interaction}
\rightarrow
\text{particle/photon transport}
\rightarrow
\text{observable}
}
$$

而不是只按 GRB、FRB、SN 等现象命名。

## 5. 首批上线的 24 篇 Core Papers

### R1：Central Engines（6 篇）

1. **Yu, Zhang & Gao 2013** — Bright merger-nova from a neutron-star merger remnant.  
   [arXiv:1308.0876](https://arxiv.org/abs/1308.0876)  
   作用：magnetar rotational energy 注入 merger ejecta；central-engine 谱系起点。

2. **Yu, Li & Dai 2015** — Rapidly Evolving and Luminous Transients Driven by Newly Born Neutron Stars.  
   [arXiv:1505.03251](https://arxiv.org/abs/1505.03251)  
   作用：从 mergernova 推广到快速高亮瞬变。

3. **Liu et al. 2017** — A Monte Carlo Approach to Magnetar-powered Transients I.  
   [arXiv:1705.06047](https://arxiv.org/abs/1705.06047)  
   作用：从单源解释进入参数空间和 population inference。

4. **Liu et al. 2022** — Magnetar Engines in Fast Blue Optical Transients.  
   [arXiv:2206.03303](https://arxiv.org/abs/2206.03303)  
   作用：比较 FBOT、SLSN、Ic-BL 与 LGRB 的 central-engine 参数空间。

5. **Li et al. 2026** — TransFit-MAG.  
   [arXiv:2606.18842](https://arxiv.org/abs/2606.18842)  
   作用：耦合 magnetar-inflated PWN、forward shock、shock breakout 与 time-dependent diffusion。

6. **Wu, Yu & Liu 2026** — A Magnetar Engine and Circumstellar Medium Interaction.  
   [arXiv:2607.08216](https://arxiv.org/abs/2607.08216)  
   作用：从 `magnetar OR CSM` 进入 `magnetar + CSM` 动力学耦合。

### R2：Relativistic Jets & GRBs（4 篇）

1. **Tan & Yu 2020** — The Jet Structure and the Intrinsic Luminosity Function of Short GRBs.  
   [arXiv:2006.02060](https://arxiv.org/abs/2006.02060)  
   作用：联合 intrinsic luminosity function、jet structure 与 viewing angle。

2. **Yu 2020** — Gravitational-wave Memory from a Propagating Relativistic Jet.  
   [arXiv:2001.00205](https://arxiv.org/abs/2001.00205)  
   作用：把 jet propagation 转化为 GW observable。

3. **Zhang et al. 2022** — Diagnosing Circumburst Environment with Multiband GRB Radio Afterglows.  
   [arXiv:2203.08646](https://arxiv.org/abs/2203.08646)  
   作用：用多频射电光变反演 $n\propto R^{-k}$。

4. **Zhang, Zhu & Yu 2024** — Propagation of GRB Relativistic Jets in AGN Disks.  
   [arXiv:2406.10904](https://arxiv.org/abs/2406.10904)  
   作用：建立 jet head、collimation、choking 与 breakout 的 AGN-disk 分支。

### R3：Explosive Transients / CSM（6 篇）

1. **Liu et al. 2018** — Multiple Ejecta-CSM Interaction Model.  
   [arXiv:1802.08164](https://arxiv.org/abs/1802.08164)  
   作用：用多层 CSM 解释 bumpy SLSN light curves。

2. **Liu, Wang & Gao 2020** — A Reader Friendly Formalism for CSM-SN Ejecta Interaction.  
   [arXiv:2009.11103](https://arxiv.org/abs/2009.11103)  
   作用：使 CSM 半解析模型的 scaling 和参数依赖更透明。

3. **Liu et al. 2025** — TransFit.  
   [arXiv:2505.13825](https://arxiv.org/abs/2505.13825)  
   作用：用 time-dependent radiative diffusion 替代关键 Arnett-like 空间简化。

4. **Zhang et al. 2025/2026** — TransFit-CSM.  
   [arXiv:2511.13265](https://arxiv.org/abs/2511.13265)  
   作用：耦合移动 shock heating boundary 与演化的 photon escape path。

5. **Liu et al. 2026** — Radio Emission from FBOTs Powered by Trans-relativistic Shocks in Confined CSM.  
   [arXiv:2605.17280](https://arxiv.org/abs/2605.17280)  
   作用：由 radio morphology 约束 confined CSM 和爆发前质量损失历史。

6. **Ni et al. 2026** — Mapping the Dense CSM of SNe Ibn, SNe Icn, and FBOTs.  
   [arXiv:2607.00453](https://arxiv.org/abs/2607.00453)  
   作用：将统一 TransFit-CSM 拟合推进到 25 个源的 population comparison。

### R4：Pulsar Winds / High-energy Binaries（3 篇）

1. **Chen et al. 2019** — PSR B1259−63/LS 2883.  
   [arXiv:1904.07527](https://arxiv.org/abs/1904.07527)  
   作用：Be-disk passage 改变 shock geometry，并产生 synchrotron/IC 双峰。

2. **Chen & Takata 2022** — Correlated keV/TeV Light Curves of Be/gamma-ray Binaries.  
   [arXiv:2112.00345](https://arxiv.org/abs/2112.00345)  
   作用：从单系统推广到 binary geometry 的统一辐射框架。

3. **Du et al. 2026** — Radio eclipse of PSR J1932+2121 and its X-ray emission prospect.  
   [arXiv:2606.24069](https://arxiv.org/abs/2606.24069)  
   作用：把 FAST eclipse/DM 信息连接到 intrabinary-shock X-ray 预言。

### R5：Magnetar Bursts / FRB Environments（2 篇）

1. **Du et al. 2026** — FRB 20220529 environment model.  
   [arXiv:2601.02734](https://arxiv.org/abs/2601.02734)  
   作用：companion/precession 驱动 RM/DM 演化；FRB 作为 binary-environment probe。

2. **Xie et al. 2025/2026** — Eclipsed X-ray Bursts from SGR J1935+2154.  
   [arXiv:2510.24075](https://arxiv.org/abs/2510.24075)  
   作用：通过 eclipse 反演 magnetospheric fireball geometry。

### R6：Dense Environment / Multi-messenger（3 篇）

1. **Zhu et al. 2021** — Neutron-star mergers in AGN disks: cocoon and ejecta shock breakouts.  
   [arXiv:2011.08428](https://arxiv.org/abs/2011.08428)  
   作用：特殊环境改变 merger 的 ejecta/cocoon 电磁信号。

2. **Zhu et al. 2021** — High-energy Neutrinos from Choked GRBs in AGN Disks.  
   [arXiv:2103.00789](https://arxiv.org/abs/2103.00789)  
   作用：将 choked embedded jet 与高能中微子联系起来。

3. **Long & Yu 2026** — High-energy neutrino signatures of embedded GRB jets in AGN disks.  
   [arXiv:2608.12217](https://arxiv.org/abs/2608.12217)  
   作用：以 full trajectory integration 替代 single representative jet state。

## 6. 11 篇 Foundation Papers

| ID | 论文 | Physics kernel |
|---|---|---|
| F01 | Blandford & McKee 1976, DOI `10.1063/1.861619` | relativistic self-similar blast wave |
| F02 | Sari, Piran & Narayan 1998, [astro-ph/9712005](https://arxiv.org/abs/astro-ph/9712005) | synchrotron afterglow |
| F03 | Bromberg et al. 2011, [arXiv:1107.1326](https://arxiv.org/abs/1107.1326) | jet head / cocoon / collimation |
| F04 | Kasen & Bildsten 2010, [arXiv:0911.0680](https://arxiv.org/abs/0911.0680) | magnetar spin-down + diffusion |
| F05 | Arnett 1982, DOI `10.1086/159681` | expanding-ejecta diffusion |
| F06 | Chevalier 1982, DOI `10.1086/160126` | ejecta-CSM self-similar FS/RS |
| F07 | Weaver et al. 1977, DOI `10.1086/155692` | continuous wind bubble / FS-CD-RS |
| F08 | Dubus 2013, [arXiv:1307.7083](https://arxiv.org/abs/1307.7083) | gamma-ray binary / pulsar-wind shock |
| F09 | Metzger, Berger & Margalit 2017, [arXiv:1701.02370](https://arxiv.org/abs/1701.02370) | magnetar-SLSN-LGRB-FRB bridge |
| F10 | Zhang 2023, [arXiv:2212.03972](https://arxiv.org/abs/2212.03972) | FRB physics map |
| F11 | Khatami & Kasen 2024, [arXiv:2304.03360](https://arxiv.org/abs/2304.03360) | CSM-interaction morphology |

## 7. 第二轮扩展池：10 篇

1. Li, Liu, Yu & Zhang 2018 — AT2017gfo / magnetar injection。
2. Zhu et al. 2024 — Bumpy SLSNe Powered by a Magnetar-Star Binary Engine。
3. Liu et al. 2023 — Population Study on the Radio Emission of FBOTs。
4. Wei et al. 2026 — SN 2024aecx；shock cooling + radioactive heating。
5. Chen et al. 2021 — 1FGL J1018.6−5856。
6. Chen, Takata & Yu 2024 — LS I $+61^\circ303$；Be-disk precession。
7. Gao et al. 2025 — targeted FRB search in AT2018cow/CSS161010。
8. Xie et al. 2026 — heavy nuclei from the neutron-star crust；[arXiv:2604.24750](https://arxiv.org/abs/2604.24750)。
9. Zhu et al. 2021 — WD explosions/AIC in AGN disks。
10. Wu et al. 2025 — EP241021a magnetar interpretation。

扩展池不是“次要论文”，只是等首版图谱结构闭合后再加入。

## 8. Learning Paths

### CSM interaction

$$
\mathrm{Chevalier\ 1982}
\rightarrow
\mathrm{Liu+2018}
\rightarrow
\mathrm{Liu+2020}
\rightarrow
\mathrm{TransFit}
\rightarrow
\mathrm{TransFit\text{-}CSM}
\rightarrow
\mathrm{Ni+2026}.
$$

对应：

`self-similar dynamics → semi-analytic usability → time-dependent diffusion → moving shock/diffusion coupling → population inference`

### Magnetar transient

$$
\mathrm{Kasen\ \&\ Bildsten\ 2010}
\rightarrow
\mathrm{Yu+2013}
\rightarrow
\mathrm{Yu+2015}
\rightarrow
\mathrm{Liu+2022}
\rightarrow
\mathrm{TransFit\text{-}MAG}
\rightarrow
\mathrm{Wu+2026}.
$$

### Jet propagation

$$
\mathrm{BM76}
\rightarrow
\mathrm{Bromberg+2011}
\rightarrow
\mathrm{Zhang+2024}
\rightarrow
\mathrm{Long\ \&\ Yu\ 2026}.
$$

对应：

`relativistic blast wave → jet head/cocoon → embedded jet → trajectory-dependent neutrino emission`

### Pulsar binary

$$
\mathrm{Dubus\ 2013}
\rightarrow
\mathrm{Chen+2019}
\rightarrow
\mathrm{Chen\ \&\ Takata\ 2022}
\rightarrow
\mathrm{Du+2026}.
$$

## 9. 多轴 Tag Ontology

不要使用单一的 `topic: supernova`。

| Axis | 示例 |
|---|---|
| `phenomenon` | GRB, SLSN, FBOT, FXT, FRB, kilonova, magnetar-burst, gamma-ray-binary |
| `progenitor` | massive-star, BNS, NS-WD, WD-WD, AIC |
| `engine` | magnetar, pulsar, BH-accretion, radioactive, shock |
| `outflow` | relativistic-jet, pulsar-wind, magnetar-wind, SN-ejecta, cocoon |
| `environment` | CSM, stellar-envelope, AGN-disk, Be-disk, stellar-wind, magnetosphere |
| `dynamics` | FS, RS, jet-head, collimation, choking, breakout, diffusion, shock-cooling |
| `radiation` | synchrotron, IC, thermal, SSA, FFA, pp, pγ |
| `messenger` | radio, optical, X-ray, gamma-ray, neutrino, GW |
| `method` | analytic, semi-analytic, numerical, MCMC, population, radiative-transfer |

此外保留两个非物理 meta tags：

- `reading_role`
- `group_lineage`

### reading_role

只允许以下 6 类：

| Tag | 含义 |
|---|---|
| `foundation` | 建立基本理论 |
| `review` | 建立领域地图 |
| `method` | 可直接学习或复用的方法 |
| `group-lineage` | 理解本组研究历史 |
| `frontier` | 当前前沿 |
| `opportunity` | 可能长出新课题 |

## 10. Edge Vocabulary

关系类型固定为：

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

其中最重要的是：

```text
replaces_assumption
```

它直接回答：一篇论文究竟增加了什么新物理，或删除了什么旧假设？

示例：

```text
TransFit-CSM
  replaces_assumption
fixed heating location / simplified diffusion path
```

```text
Long & Yu 2026
  replaces_assumption
single representative jet state
```

## 11. Paper Object

推荐使用 Markdown front matter / YAML：

```yaml
id: transfit-csm-2026
title: "TransFit-CSM: A Fast, Physically Consistent Framework..."
year: 2025
arxiv: "2511.13265"

primary_line: R3
secondary_lines: [R1]

physics_kernel:
  - ejecta-csm-interaction
  - forward-shock
  - reverse-shock
  - radiative-diffusion

reading_role:
  - method
  - group-lineage

scientific_takeaway: >
  Shock heating and photon diffusion must evolve
  with the moving shock geometry.

replaces_assumption:
  - fixed-heating-location
  - simplified-diffusion-path

builds_on:
  - chevalier-1982
  - liu-csm-2020
  - transfit-2025

enables:
  - csm-population-inference
  - ibn-icn-fbot-comparison

prerequisites:
  - homologous-ejecta
  - shock-jump-conditions
  - radiative-diffusion

next_read:
  - ni-2026

difficulty: 4
metadata_status: verified
```

`scientific_takeaway` 不是 abstract summary，而应是可迁移、可检验的物理判断。

## 12. 推荐系统

推荐分数可写成：

$$
S_{\rm paper}
=
w_R R_{\rm line}
+w_P P_{\rm physics}
+w_L L_{\rm lineage}
+w_N N_{\rm novelty}
+w_A A_{\rm actionability}.
$$

其中应提高：

$$
w_P,\quad w_A.
$$

也就是说：一个主题很近但只是重复已有模型的论文，不应排在一个主题稍远、却替换了关键假设或提供新方法的论文前面。

## 13. 网站 MVP

V1 只需要四个页面：

| 页面 | 内容 |
|---|---|
| `Today` | 当天 0–3 篇 Must Read / Worth Knowing |
| `Research Map` | 6 条 Research Line + physics kernels + hubs |
| `Learning Paths` | Concept → Method → Current research |
| `Paper` | Problem → Assumption → Physics → Result → Why we care → Previous/Next |

V1 暂时不需要：

- 论坛；
- 用户系统；
- 点赞；
- 复杂推荐引擎；
- 数千篇自动导入。

## 14. 下一步

### Step 1：元数据核验

逐篇核对：

- title；
- author order；
- year；
- arXiv；
- DOI；
- journal；
- version；
- canonical ID。

### Step 2：内容标注

为首批 35 篇填写：

- `problem`
- `core_assumption`
- `physics_kernel`
- `result`
- `scientific_takeaway`
- `prerequisites`
- `next_read`

### Step 3：Edge 审核

- 每篇 Core 至少建立 2 条有物理含义的 edge。
- `replaces_assumption` 必须能回到正文或方法部分。
- 禁止用模糊的“相关工作”代替关系定义。

### Step 4：数据导出

生成：

```text
papers.yaml
edges.yaml
ontology.yaml
```

通过 schema validation 后再接网站前端。

## 15. 验收标准

- [ ] 35 篇首发论文的 arXiv/DOI 无错误、无重复。
- [ ] 每篇都有且只有一个 `primary_line`。
- [ ] 每篇都有 primary `reading_role`。
- [ ] 每篇都有 `scientific_takeaway`、`prerequisites`、`next_read`。
- [ ] 每条 edge 使用冻结 vocabulary，并能解释其物理意义。
- [ ] 至少 4 条 Learning Path 从 foundation 连到 current research。
- [ ] 每一步说明“为什么下一篇读它”。
- [ ] 复杂 taxonomy 只在 Research Map / Paper 页面展开。

## 16. 数据质量说明

本文件整理自前序公开调查，并对以下近期条目进行了重点复核：

- [TransFit](https://arxiv.org/abs/2505.13825)
- [TransFit-CSM](https://arxiv.org/abs/2511.13265)
- [TransFit-MAG](https://arxiv.org/abs/2606.18842)
- [Magnetar + CSM](https://arxiv.org/abs/2607.08216)
- [Dense CSM population](https://arxiv.org/abs/2607.00453)
- [FBOT radio / confined CSM](https://arxiv.org/abs/2605.17280)
- [PSR J1932+2121](https://arxiv.org/abs/2606.24069)
- [Magnetar heavy nuclei](https://arxiv.org/abs/2604.24750)
- [AGN-disk GRB jet propagation](https://arxiv.org/abs/2406.10904)
- [Dynamic embedded-jet neutrinos](https://arxiv.org/abs/2608.12217)

其余条目在正式导入数据库前，仍需按统一规则核验元数据。

> **最终原则：先把 35 个高价值节点之间的因果关系做对，再扩大到 5000 篇。**
