import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GUILD_ID = "612912874093545504";
const CHANNEL_ID = "742956302"; // 前沿学术周报

const title = "[2026-W40] 前沿周报 ｜ 等离子体透镜放大率与激波破越温度演化";

const markdownContent = `2026-09-28 至 2026-10-04

## 🌌 本周导读

本周前沿聚焦于快速射电暴等离子体透镜效应、超长伽马暴前身星约束以及高能暂现源激波破越的早期辐射机制。各课题组结合高精度时变与能谱观测，推动了极端天体物理爆发环境模型的定量检验。

---

## ⭐ 建议优先阅读

**必读 · [arXiv:2610.04367v1](https://arxiv.org/abs/2610.04367v1)** (Maokai Hu 等)

*Fast X-ray Transient EP260321a: Shock Breakout through an Extended Circumstellar Matter*

扩展周星介质（CSM）激波破越模型成功再现软 X 射线光变与温度演化，为富含星周壳层的前身星爆发提供关键物理判据。

---

## 📌 领域进展矩阵

| 领域方向 | 核心物理脉络 | 重点关注文献 |
| :--- | :--- | :--- |
| **快速射电暴与透镜** | 等离子体透镜预言放大率分布与毫秒级时延 | [arXiv:2609.18234](https://arxiv.org/abs/2609.18234) |
| **相对论喷流与超长GRB** | 两段亮期静默 $600\\,{\\rm s}$ 限制蓝超巨星候选前身星 | [arXiv:2609.17882](https://arxiv.org/abs/2609.17882) |
| **超新星激波破越** | 扩展周星壳层 $R_{\\rm out}\\approx600R_\\odot$ 解释升温 | [arXiv:2610.04367](https://arxiv.org/abs/2610.04367) |

---

## 📚 阅读入口
- **内网/校内完整网页与图表**: [打开网页周报矩阵](http://10.131.43.83:4321/arxiv-weekly/2026-W40/)
- **QQ 频道社区交流帖**: [进入周报讨论](https://pd.qq.com/s/d4lw4zl0g)

*本周报基于 AstroLineage 学术研判引擎自动梳理生成。*

<!-- astrolineage-channel:weekly-post:2026-W40 -->`;

async function publish() {
  console.log("正在通过 tencent-channel-cli 发布周报测试帖子...");
  const args = [
    "feed",
    "publish-feed",
    "--guild-id",
    GUILD_ID,
    "--channel-id",
    CHANNEL_ID,
    "--title",
    title,
    "--markdown-content",
    markdownContent,
    "--json",
  ];

  try {
    const { stdout } = await execFileAsync("tencent-channel-cli", args);
    const result = JSON.parse(stdout);
    console.log("发布成功:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("发布失败:", err.stdout || err.message);
  }
}

publish();
