# Secure Token Vesting & Escrow DApp

> 基于 Solana 的去中心化 Token 锁仓与释放基础设施，支持 Cliff + 线性释放模型，提供 Anchor 与 Pinocchio 双合约实现。

## 💻 项目 Repo

https://github.com/davidweb3-ctrl/vesting-dapp

## 📌 项目简介

**Secure Token Vesting & Escrow DApp** 是一个构建在 Solana 主链上的 Token 锁仓与释放基础设施模块。通过链上 Program 托管 Token，按预设时间规则（Cliff + Linear）自动释放资产，解决当前 Solana 生态中 Token 分发安全性不足、标准缺失、工程重复的问题。

在 Solana 生态 TVL 达 $350 亿、年部署 Token 超 500 万个的市场背景下，98.7% 的 Pump.fun Token 呈现 Rug Pull 特征。本项目通过 **PDA 控制 Vault（无私钥）**、**参数创建后不可篡改**、**released_amount 单调递增** 等机制，从架构层面杜绝 Rug Pull 风险，让 Token 释放成为链上可验证、可审计的标准能力。

项目同时提供 **Anchor** 和 **Pinocchio（原生 Solana Program）** 两套实现，功能完全一致，用于交叉验证和 CU 性能对比。

---

## 🛠️ 技术栈

- **智能合约**：Rust + Anchor Framework 0.32.1 + Pinocchio 0.10
- **前端**：Next.js 16 + React 19 + TypeScript + Tailwind CSS
- **钱包适配**：@solana/wallet-adapter（Phantom / Solflare）
- **链上交互**：@solana/web3.js 1.x + @coral-xyz/anchor + @solana/spl-token
- **状态管理**：TanStack React Query
- **测试**：ts-mocha + Chai + solana-test-validator
- **工具链**：Solana CLI 3.1.7, Anchor CLI 0.32.1, pnpm, Rust 1.92.0

---

## 🎬 Demo 演示

### 演示链接

- 🌐 在线 Demo：（部署中）
- 🎥 视频演示：（录制中）

### 功能截图

> 截图待补充

---

## 💡 核心功能

1. **创建锁仓计划** — Project Owner 为指定 Beneficiary 创建链上 Vesting，设定 Cliff 期与线性释放周期
2. **存入 Token（Escrow）** — Admin 将 Token 存入 Program 控制的 Vault（PDA 为 owner，无私钥），实现单向托管
3. **自主领取 Token（Claim）** — Beneficiary 在 Cliff 后按线性释放规则自主 Claim，无需项目方操作
4. **链上可审计** — 所有状态链上可查，Vault 余额 = total_amount - released_amount，任何人可独立验证
5. **双合约交叉验证** — Anchor + Pinocchio 双实现，相同 PDA、相同逻辑、相同数据格式，CU 对比可量化

---

## 📊 性能对比（CU 消耗）

| 指令 | Anchor | Pinocchio | 节省 |
| --- | --- | --- | --- |
| `create_vesting` | 44,606 CU | 1,620 CU | **96.4%** |
| `deposit` | 21,355 CU | 7,788 CU | **63.5%** |

---

## 📁 项目结构

```
vesting-dapp/
├── docs/                              # 项目文档
│   ├── PROJECT_PROPOSAL.md            # 产品立项说明书
│   ├── SRS.md                         # 软件需求规格说明书
│   ├── ARCHITECTURE.md                # 技术架构说明书
│   └── reports/                       # 测试报告
│       ├── TEST_REPORT.md             # 综合测试报告（需求覆盖率 + 代码覆盖率）
│       └── SECURITY_TEST_REPORT.md    # 安全测试报告
│
├── programs/anchor-vesting/           # Anchor 版合约
│   └── src/
│       ├── lib.rs                     # Program 入口
│       ├── instructions/              # 指令实现 (create, deposit, claim)
│       ├── state/                     # VestingAccount 状态定义
│       └── errors.rs                  # 错误码 (10 种)
│
├── pinocchio-vesting/                 # Pinocchio 版合约（原生实现）
│   └── src/
│       └── lib.rs                     # 完整实现 (手动校验 + CPI)
│
├── app/                               # Next.js 前端
│   └── app/
│       ├── components/                # UI 组件 (Header, VestingCard)
│       ├── hooks/                     # useVestingProgram (React Query)
│       ├── providers/                 # Wallet/Cluster/Query Providers
│       ├── create/page.tsx            # 创建锁仓页面
│       ├── dashboard/page.tsx         # 锁仓列表 Dashboard
│       └── claim/page.tsx             # Claim 页面
│
├── tests/                             # 集成测试 (48 用例，100% 通过)
│   ├── anchor-vesting.test.ts         # Anchor 测试 (19 用例)
│   ├── pinocchio-vesting.test.ts      # Pinocchio 测试 (10 用例)
│   ├── comparison.test.ts             # CU 对比测试 (3 用例)
│   └── security.test.ts              # 安全测试 (16 用例)
│
├── scripts/test.sh                    # 一键测试脚本
├── Anchor.toml                        # Anchor 配置
├── Cargo.toml                         # Rust workspace
└── package.json                       # Node.js 依赖
```

---

## 🚀 快速开始

### 环境要求

- Rust 1.92+
- Solana CLI 3.x
- Anchor CLI 0.32.x
- Node.js 20+
- pnpm 10+

### 1. 克隆与安装

```bash
git clone https://github.com/davidweb3-ctrl/vesting-dapp.git
cd vesting-dapp
pnpm install
```

### 2. 构建合约

```bash
# 构建 Anchor 合约
anchor build

# 构建 Pinocchio 合约
cd pinocchio-vesting && cargo build-sbf && cd ..
```

### 3. 运行测试

```bash
# 一键测试（推荐）
bash scripts/test.sh

# 或手动启动 validator 后运行
solana-test-validator --bind-address 127.0.0.1 --rpc-port 8899 \
  --ledger .anchor/test-ledger --reset \
  --bpf-program BB1JtUxXtmDnb6L5qXUSfuvT18TggYuSLBzfmjoYFnb4 target/deploy/anchor_vesting.so \
  --bpf-program EzRUZpW3CsvnKzEUiF7fAPHyHWsv2D3ERR482BPKHwYk pinocchio-vesting/target/deploy/pinocchio_vesting.so

# 另一个终端
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  pnpm exec ts-mocha -p ./tsconfig.json -t 1000000 "tests/**/*.test.ts"
```

### 4. 启动前端

```bash
cd app
pnpm install
pnpm dev
```

访问 http://localhost:3000

---

## 🧪 测试覆盖

| 维度 | 覆盖率 |
| --- | --- |
| SRS 需求覆盖率（TR-1 ~ TR-5，25 用例） | **100%** |
| 错误码覆盖率（FR-7，10 个错误码） | **100%** |
| 指令级覆盖率（正常 + 错误路径） | **100%** |
| 核心算法分支覆盖率（calculate_released） | **100%** |
| 数据不变量覆盖率（INV-1 ~ INV-7） | **100%** |
| 威胁模型覆盖率（7 种威胁） | **100%** |

详细报告见：
- [综合测试报告](docs/reports/TEST_REPORT.md)
- [安全测试报告](docs/reports/SECURITY_TEST_REPORT.md)

---

## 🔐 安全设计

| 安全机制 | 说明 |
| --- | --- |
| PDA 控制 Vault | Vault 的 owner 为 PDA，无私钥，无法被人工签名转出 |
| 参数不可篡改 | 创建后所有参数（含 end_time、total_amount）不可修改 |
| 无 Withdraw 指令 | 合约不提供任何取回 Token 的指令，从设计上杜绝 Rug Pull |
| released_amount 单调递增 | 不可回退已释放状态，使用 checked_add 防溢出 |
| u128 安全运算 | 释放计算使用 u128 中间变量，整数除法向下取整，防止超额释放 |
| 严格角色隔离 | Admin 只能 deposit，Beneficiary 只能 claim，互不越权 |

---

## 📄 项目文档

| 文档 | 说明 |
| --- | --- |
| [产品立项说明书](docs/PROJECT_PROPOSAL.md) | 市场分析、竞品对比、商业模式、演进路径 |
| [软件需求规格说明书](docs/SRS.md) | 业务需求、功能需求、非功能需求、测试需求、验收标准 |
| [技术架构说明书](docs/ARCHITECTURE.md) | 数据模型、指令流程、安全架构、前端架构、CPI 设计 |
| [综合测试报告](docs/reports/TEST_REPORT.md) | 48 用例结果、需求覆盖率、代码覆盖率、CU 对比 |
| [安全测试报告](docs/reports/SECURITY_TEST_REPORT.md) | 威胁模型验证、访问控制、数据完整性、溢出防护 |

---

## 🏗️ 合约地址

### Devnet（已部署）

| Program | Program ID | 状态 | Explorer 链接 |
| --- | --- | --- | --- |
| Anchor Vesting | `BB1JtUxXtmDnb6L5qXUSfuvT18TggYuSLBzfmjoYFnb4` | ✅ 已部署 | [查看](https://explorer.solana.com/address/BB1JtUxXtmDnb6L5qXUSfuvT18TggYuSLBzfmjoYFnb4?cluster=devnet) |
| Pinocchio Vesting | `3XcZJ34qBmN2g9joSeVH2kBQkmh2ZVV3e6dRMb7TCq3h` | ✅ 已部署 | [查看](https://explorer.solana.com/address/3XcZJ34qBmN2g9joSeVH2kBQkmh2ZVV3e6dRMb7TCq3h?cluster=devnet) |

### Localnet（测试）

| Program | Program ID |
| --- | --- |
| Anchor Vesting | `BB1JtUxXtmDnb6L5qXUSfuvT18TggYuSLBzfmjoYFnb4` |
| Pinocchio Vesting | `EzRUZpW3CsvnKzEUiF7fAPHyHWsv2D3ERR482BPKHwYk` |

> **注意**：Pinocchio 的 Program ID 在 Devnet 和 Localnet 上不同，因为原生 Solana 程序的 Program ID 就是 keypair 的公钥。测试文件中的 `EzRUZpW3CsvnKzEUiF7fAPHyHWsv2D3ERR482BPKHwYk` 是 Localnet 测试用的 keypair。

---

## ✍️ 项目创作者

1. **昵称**：david.xia
2. **联系方式**：prodavidweb3@gmail.com
3. **Solana USDC 钱包地址**：EDFxPF6yAQNod3nFzwV7z1qwSjt42WDYzmdT6b6YHDh7

---

## 📜 License

MIT
