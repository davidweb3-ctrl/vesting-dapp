# 《Secure Token Vesting & Escrow DApp》

## 技术架构说明书（Technical Architecture Document）

> 本文档是项目的技术架构设计文档，面向开发团队与技术评审。
> 立项说明书回答"为什么做"，SRS 回答"做什么"，本文档回答**"怎么构建"**。

---

## 1. 架构概述（Architecture Overview）

### 1.1 设计原则

| 优先级 | 原则 | 说明 |
| --- | --- | --- |
| P0 | 安全性优先 | 资产由 PDA 控制，无私钥泄露风险；所有权限在指令入口校验 |
| P1 | 链上可验证 | 所有业务规则链上执行，前端不参与释放计算；状态可交叉验证 |
| P2 | 最小权限 | 每条指令仅接受必要账户，角色权限严格隔离 |
| P3 | 确定性执行 | 所有指令为固定路径（无循环、无动态分配），CU 消耗可预测 |
| P4 | 模块化复用 | Program 与前端解耦，Program 可被 CLI / SDK / 第三方前端调用 |

---

### 1.2 系统分层架构

```
┌─────────────────────────────────────────────────────┐
│                   用户层（User Layer）                 │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Web DApp │  │ CLI Tool │  │ 第三方集成 (SDK) │     │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       │              │                 │             │
└───────┼──────────────┼─────────────────┼─────────────┘
        │              │                 │
┌───────┼──────────────┼─────────────────┼─────────────┐
│       ▼              ▼                 ▼             │
│              交互层（Interaction Layer）               │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  @solana/web3.js + Anchor Client / Raw TX      │  │
│  │  Wallet Adapter (Phantom / Solflare)           │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │                              │
└───────────────────────┼──────────────────────────────┘
                        │ RPC (JSON-RPC / WebSocket)
┌───────────────────────┼──────────────────────────────┐
│                       ▼                              │
│              Solana 运行时层（Runtime Layer）           │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │             Solana Validator                  │    │
│  │  ┌────────────────┐  ┌────────────────────┐  │    │
│  │  │ Vesting Program│  │  SPL Token Program │  │    │
│  │  │ (Anchor 版)    │  │                    │  │    │
│  │  ├────────────────┤  ├────────────────────┤  │    │
│  │  │ Vesting Program│  │  ATA Program       │  │    │
│  │  │ (Pinocchio 版) │  │                    │  │    │
│  │  └────────┬───────┘  └────────────────────┘  │    │
│  │           │                                   │    │
│  │  ┌────────▼──────────────────────────────┐   │    │
│  │  │          Account Storage              │   │    │
│  │  │  Vesting Account (PDA) │ Vault (ATA)  │   │    │
│  │  └───────────────────────────────────────┘   │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

### 1.3 核心交互关系

```
Project Owner                          Beneficiary
     │                                      │
     │ 1. create_vesting                    │
     │────────────────► Vesting Program     │
     │                      │               │
     │ 2. deposit           │               │
     │────────────────► SPL Transfer        │
     │                      │               │
     │               ┌──────▼──────┐        │
     │               │   Vault     │        │
     │               │ (PDA owned) │        │
     │               └──────┬──────┘        │
     │                      │               │
     │                      │ 3. claim      │
     │                      │◄──────────────│
     │                      │               │
     │               SPL Transfer           │
     │                      │───────────────►  Beneficiary ATA
```

---

## 2. 链上架构（On-Chain Architecture）

### 2.1 Program 概览

项目提供两套**功能一致**的链上 Program 实现：

| 维度 | Anchor 版 | Pinocchio 版 |
| --- | --- | --- |
| 框架 | Anchor Framework | 原生 Solana Program（Pinocchio） |
| 语言 | Rust + Anchor 宏 | Rust（纯手写） |
| 账户校验 | Anchor Account Constraints | 手动校验 |
| 序列化 | Borsh（Anchor 自动） | Borsh（手动实现） |
| CPI | anchor_spl::token | solana_program::program::invoke_signed |
| 预期 CU | 较高（Anchor 框架开销） | 较低（无框架开销） |
| 用途 | 主实现，前端默认调用 | 交叉验证，性能对比 |

**关键约束**：两套 Program 必须使用**相同的 Account 数据布局与序列化格式（Borsh）**，确保互操作性。

---

### 2.2 Account 数据模型

#### 2.2.1 VestingAccount 结构

```rust
#[account]
pub struct VestingAccount {
    pub admin: Pubkey,           // 32 bytes - 创建者
    pub beneficiary: Pubkey,     // 32 bytes - 受益人
    pub mint: Pubkey,            // 32 bytes - Token Mint
    pub total_amount: u64,       // 8  bytes - 锁仓总量
    pub released_amount: u64,    // 8  bytes - 已释放数量
    pub start_time: i64,         // 8  bytes - 开始时间
    pub cliff_time: i64,         // 8  bytes - Cliff 时间
    pub end_time: i64,           // 8  bytes - 结束时间
    pub seed: u64,               // 8  bytes - 唯一种子
    pub bump: u8,                // 1  byte  - PDA bump
}
```

#### 2.2.2 字节布局（Byte Layout）

```
Offset  Size  Field
──────  ────  ─────────────────
0       8     Anchor Discriminator (Anchor 版特有)
8       32    admin
40      32    beneficiary
72      32    mint
104     8     total_amount
112     8     released_amount
120     8     start_time
128     8     cliff_time
136     8     end_time
144     8     seed
152     1     bump
──────────────────────────────
Total:  153 bytes (Anchor 版)
        145 bytes (Pinocchio 版, 无 Discriminator)
```

**Account 空间分配**（Anchor 版）：

```
space = 8 (discriminator) + 32 * 3 + 8 * 5 + 8 + 1 = 153 bytes
rent = Rent::minimum_balance(153)
```

#### 2.2.3 数据不变量（Invariants）

以下不变量在系统生命周期内**始终成立**：

```
INV-1: vesting.released_amount <= vesting.total_amount
INV-2: vesting.start_time <= vesting.cliff_time <= vesting.end_time
INV-3: vesting.start_time < vesting.end_time
INV-4: vesting.total_amount > 0
INV-5: vault.amount == vesting.total_amount - vesting.released_amount  (Funded 后)
INV-6: vault.owner == vesting_pda
INV-7: vault.mint == vesting.mint
```

---

### 2.3 PDA 派生方案

#### Vesting PDA

```rust
let (vesting_pda, bump) = Pubkey::find_program_address(
    &[
        b"vesting",
        beneficiary.key().as_ref(),
        mint.key().as_ref(),
        &seed.to_le_bytes(),
    ],
    program_id,
);
```

**种子设计决策**：

* `b"vesting"` — 命名空间前缀，防止与其他 PDA 冲突
* `beneficiary` — 按受益人维度索引
* `mint` — 按 Token 类型维度索引
* `seed` (u64) — 唯一标识符，支持同一 beneficiary + mint 创建多个 Vesting
* `bump` — 保存在 Account 中，后续指令直接使用（避免重复计算）

#### Vault（ATA）

```rust
let vault = get_associated_token_address(
    &vesting_pda,  // owner
    &mint,         // mint
);
```

Vault 使用标准 ATA 派生，**不自定义种子**，遵循 SPL 标准。

---

### 2.4 指令处理流程

#### 2.4.1 create_vesting

```
输入: beneficiary, mint, total_amount, start_time, cliff_time, end_time, seed
│
├─ 校验参数
│   ├─ total_amount > 0                     → InvalidAmount
│   ├─ start_time <= cliff_time             → InvalidTimeRange
│   ├─ cliff_time <= end_time               → InvalidTimeRange
│   └─ start_time < end_time                → InvalidTimeRange
│
├─ 派生 PDA
│   └─ seeds = ["vesting", beneficiary, mint, seed]
│
├─ 初始化 Vesting Account (PDA)
│   ├─ admin = signer
│   ├─ beneficiary, mint, total_amount, start_time, cliff_time, end_time, seed
│   ├─ released_amount = 0
│   └─ bump = derived bump
│
├─ 初始化 Vault (ATA)
│   ├─ owner = vesting_pda
│   └─ mint = mint
│
└─ 完成 → 状态: Initialized
```

#### 2.4.2 deposit

```
输入: (无额外参数, 金额由 vesting.total_amount 决定)
│
├─ 校验权限
│   └─ signer == vesting.admin              → UnauthorizedAdmin
│
├─ 校验状态
│   └─ vault.amount == 0                    → AlreadyFunded (if > 0)
│
├─ CPI: SPL Token Transfer
│   ├─ from: admin_token_account
│   ├─ to: vault
│   ├─ amount: vesting.total_amount
│   └─ authority: admin (signer)
│
└─ 完成 → 状态: Funded
```

#### 2.4.3 claim

```
输入: (无额外参数, 金额由链上计算)
│
├─ 校验权限
│   └─ signer == vesting.beneficiary        → UnauthorizedBeneficiary
│
├─ 校验状态
│   └─ vault.amount > 0                     → NotFunded (if == 0)
│
├─ 获取当前时间
│   └─ now = Clock::get()?.unix_timestamp
│
├─ 计算释放额度
│   ├─ total_released = calculate_released(now, &vesting)
│   ├─ claimable = total_released - vesting.released_amount
│   └─ claimable > 0                        → NothingToClaim (if == 0)
│
├─ CPI: SPL Token Transfer (PDA signed)
│   ├─ from: vault
│   ├─ to: beneficiary_token_account (init_if_needed)
│   ├─ amount: claimable
│   └─ authority: vesting_pda (invoke_signed)
│
├─ 更新状态
│   └─ vesting.released_amount += claimable
│
└─ 完成 → 状态: Releasing / Completed
```

---

### 2.5 CPI（跨程序调用）设计

| 调用场景 | 调用方 | 被调用方 | 签名方式 |
| --- | --- | --- | --- |
| deposit: Token 转入 Vault | Vesting Program | SPL Token Program | Admin Signer |
| claim: Token 转出 Vault | Vesting Program | SPL Token Program | PDA invoke_signed |
| 创建 Vault ATA | Vesting Program | ATA Program | Admin Signer (payer) |
| 创建 Beneficiary ATA | Vesting Program | ATA Program | Beneficiary Signer (payer, init_if_needed) |

**PDA 签名种子**（claim 时使用）：

```rust
let signer_seeds: &[&[u8]] = &[
    b"vesting",
    vesting.beneficiary.as_ref(),
    vesting.mint.as_ref(),
    &vesting.seed.to_le_bytes(),
    &[vesting.bump],
];
```

---

### 2.6 释放计算核心算法

```rust
pub fn calculate_released(now: i64, vesting: &VestingAccount) -> Result<u64> {
    // Cliff 前：完全锁定
    if now < vesting.cliff_time {
        return Ok(0);
    }

    // 完全释放
    if now >= vesting.end_time {
        return Ok(vesting.total_amount);
    }

    // 线性释放
    let elapsed = now
        .checked_sub(vesting.start_time)
        .ok_or(VestingError::Overflow)? as u64;

    let duration = vesting
        .end_time
        .checked_sub(vesting.start_time)
        .ok_or(VestingError::Overflow)? as u64;

    let released = vesting
        .total_amount
        .checked_mul(elapsed)
        .ok_or(VestingError::Overflow)?
        .checked_div(duration)
        .ok_or(VestingError::Overflow)?;

    Ok(released)
}
```

**溢出风险分析**：

* `total_amount * elapsed` 最大为 `u64::MAX * u64::MAX`，超过 u64 范围
* **缓解方案**：使用 u128 中间变量进行乘法计算

```rust
// 安全版本
let released = ((vesting.total_amount as u128)
    .checked_mul(elapsed as u128)
    .ok_or(VestingError::Overflow)?
    .checked_div(duration as u128)
    .ok_or(VestingError::Overflow)?) as u64;
```

---

### 2.7 错误处理架构

```rust
#[error_code]
pub enum VestingError {
    #[msg("Invalid time range: must satisfy start <= cliff <= end and start < end")]
    InvalidTimeRange,       // 6000

    #[msg("Invalid amount: total_amount must be greater than 0")]
    InvalidAmount,          // 6001

    #[msg("Unauthorized: only admin can deposit")]
    UnauthorizedAdmin,      // 6002

    #[msg("Unauthorized: only beneficiary can claim")]
    UnauthorizedBeneficiary, // 6003

    #[msg("Already funded: vault already contains tokens")]
    AlreadyFunded,          // 6004

    #[msg("Not funded: must deposit before claiming")]
    NotFunded,              // 6005

    #[msg("Nothing to claim: no tokens available for release")]
    NothingToClaim,         // 6006

    #[msg("Mint mismatch: deposited token mint does not match vesting")]
    MintMismatch,           // 6007

    #[msg("Deposit amount mismatch: must equal total_amount")]
    DepositAmountMismatch,  // 6008

    #[msg("Arithmetic overflow")]
    Overflow,               // 6009
}
```

---

## 3. 前端架构（Frontend Architecture）

### 3.1 技术栈

| 层 | 技术选型 | 说明 |
| --- | --- | --- |
| 框架 | Next.js 14+ (App Router) | SSR + CSR 混合，SEO 友好 |
| 语言 | TypeScript | 类型安全 |
| 样式 | Tailwind CSS | 实用优先，快速迭代 |
| 组件库 | shadcn/ui | 基于 Radix，可定制性强 |
| 钱包 | @solana/wallet-adapter-react | Phantom / Solflare |
| 链交互 | @solana/web3.js + @coral-xyz/anchor | RPC + Program 调用 |
| 状态管理 | React Query (TanStack Query) | 链上数据缓存与自动刷新 |
| 图表 | recharts | 释放曲线可视化（可选增强） |

---

### 3.2 前端组件架构

```
src/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # 全局布局 + Provider
│   ├── page.tsx                  # 首页 / Dashboard
│   ├── create/
│   │   └── page.tsx              # 创建锁仓页面
│   └── claim/
│       └── page.tsx              # Claim 页面
│
├── components/
│   ├── layout/
│   │   ├── Header.tsx            # 导航栏 + 钱包连接
│   │   ├── Footer.tsx
│   │   └── NetworkSelector.tsx   # 网络切换
│   │
│   ├── vesting/
│   │   ├── CreateVestingForm.tsx  # 创建表单
│   │   ├── VestingCard.tsx       # 单个 Vesting 卡片
│   │   ├── VestingList.tsx       # Vesting 列表
│   │   ├── VestingDetail.tsx     # Vesting 详情
│   │   ├── ClaimButton.tsx       # Claim 操作按钮
│   │   └── TimeProgress.tsx      # 时间进度可视化
│   │
│   └── ui/                       # shadcn/ui 基础组件
│       ├── Button.tsx
│       ├── Input.tsx
│       ├── Card.tsx
│       └── ...
│
├── hooks/
│   ├── useVestingProgram.ts      # Program 交互 Hook
│   ├── useVestingAccounts.ts     # 查询 Vesting 列表
│   ├── useClaimable.ts           # 计算可领取数量（展示用）
│   └── useTransactionToast.ts    # 交易反馈
│
├── lib/
│   ├── program/
│   │   ├── idl.ts                # Anchor IDL
│   │   ├── program.ts            # Program 初始化
│   │   └── types.ts              # 类型定义
│   │
│   ├── utils/
│   │   ├── calculate-released.ts # 释放计算（仅展示用，不参与链上逻辑）
│   │   ├── format-time.ts        # 时间格式化
│   │   ├── format-amount.ts      # Token 数量格式化
│   │   └── errors.ts             # 错误码映射
│   │
│   └── constants.ts              # Program ID, 网络配置
│
└── providers/
    ├── WalletProvider.tsx         # 钱包 Provider
    ├── ClusterProvider.tsx        # 网络集群 Provider
    └── QueryProvider.tsx          # React Query Provider
```

---

### 3.3 链上数据交互层

```
                         ┌─────────────────┐
                         │   React Query    │
                         │  (Cache Layer)   │
                         └────────┬────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
    ┌─────────▼──────┐  ┌────────▼───────┐  ┌────────▼───────┐
    │ useVesting     │  │ useVesting     │  │ useClaimable   │
    │ Program        │  │ Accounts       │  │                │
    │ (mutations)    │  │ (queries)      │  │ (derived)      │
    └─────────┬──────┘  └────────┬───────┘  └────────┬───────┘
              │                  │                    │
    ┌─────────▼──────────────────▼────────────────────▼───────┐
    │                   Anchor Client                         │
    │  program.methods.createVesting(...)                      │
    │  program.methods.deposit(...)                            │
    │  program.methods.claim(...)                              │
    │  program.account.vestingAccount.all(...)                 │
    └─────────────────────────┬───────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  @solana/web3.js  │
                    │  Connection (RPC) │
                    └───────────────────┘
```

**数据刷新策略**：

| 场景 | 策略 |
| --- | --- |
| 页面加载 | 查询当前钱包关联的所有 Vesting Account |
| 交易成功后 | 主动 invalidate 相关 query，立即刷新 |
| 轮询 | 每 30 秒自动刷新 Vesting 列表（可领取数量随时间变化） |
| 网络切换 | 清空全部缓存，重新查询 |

---

### 3.4 前端安全约束

| 约束 | 说明 |
| --- | --- |
| 前端**不参与释放计算** | `calculate-released.ts` 仅用于 UI 展示，链上以 Program 计算为准 |
| 私钥不离开钱包 | 所有签名通过 Wallet Adapter 完成 |
| 错误码映射 | 前端展示可读错误，不暴露内部实现细节 |
| 输入校验 | 前端做预校验（减少无效交易），但链上校验是唯一信任边界 |

---

## 4. 项目工程结构（Project Structure）

```
vesting-dapp/
│
├── docs/                              # 项目文档
│   ├── PROJECT_PROPOSAL.md            # 产品立项说明书
│   ├── SRS.md                         # 软件需求规格说明书
│   └── ARCHITECTURE.md                # 技术架构说明书（本文档）
│
├── programs/                          # 链上 Program
│   ├── anchor-vesting/                # Anchor 版实现
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs                 # Program 入口
│   │       ├── instructions/
│   │       │   ├── mod.rs
│   │       │   ├── create_vesting.rs  # create_vesting 指令
│   │       │   ├── deposit.rs         # deposit 指令
│   │       │   └── claim.rs           # claim 指令
│   │       ├── state/
│   │       │   ├── mod.rs
│   │       │   └── vesting_account.rs # VestingAccount 定义
│   │       └── errors.rs              # 错误码定义
│   │
│   └── pinocchio-vesting/             # Pinocchio 版实现
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs                 # Program 入口 + 指令路由
│           ├── instructions/
│           │   ├── mod.rs
│           │   ├── create_vesting.rs
│           │   ├── deposit.rs
│           │   └── claim.rs
│           ├── state.rs               # Account 序列化/反序列化
│           └── errors.rs              # 错误码定义
│
├── app/                               # Next.js 前端
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── next.config.mjs
│   └── src/                           # (结构见 3.2 节)
│
├── tests/                             # 集成测试
│   ├── anchor-vesting.test.ts         # Anchor 版测试
│   ├── pinocchio-vesting.test.ts      # Pinocchio 版测试
│   └── comparison.test.ts             # 双版本对比测试
│
├── Anchor.toml                        # Anchor 工程配置
├── Cargo.toml                         # Rust workspace
├── package.json                       # 根 package.json
└── README.md                          # 项目说明
```

---

## 5. Anchor vs Pinocchio 实现对比架构

### 5.1 共享与差异

```
                    ┌─────────────────────┐
                    │   Shared Contract   │
                    │                     │
                    │  • Account Layout   │  ← 相同的字节布局
                    │  • PDA Seeds        │  ← 相同的种子方案
                    │  • Vesting Logic    │  ← 相同的释放算法
                    │  • Error Codes      │  ← 相同的错误码
                    │  • Borsh Format     │  ← 相同的序列化
                    └──────────┬──────────┘
                               │
                 ┌─────────────┴─────────────┐
                 │                           │
        ┌────────▼────────┐        ┌─────────▼────────┐
        │  Anchor 版       │        │  Pinocchio 版     │
        │                 │        │                   │
        │  • #[program]   │        │  • entrypoint!    │
        │  • #[account]   │        │  • 手动反序列化    │
        │  • #[derive]    │        │  • 手动账户校验    │
        │  • CPI helpers  │        │  • invoke_signed  │
        │  • 8B 判别器     │        │  • 1B 指令标识    │
        └─────────────────┘        └───────────────────┘
```

### 5.2 互操作性保证

| 维度 | 要求 |
| --- | --- |
| Account 读取 | Pinocchio 版可读取 Anchor 版创建的 Account（跳过 8B discriminator） |
| PDA 派生 | 两版使用相同 seeds，派生出相同地址 |
| 前端调用 | 同一个前端可通过切换 Program ID 调用任一版本 |
| 测试覆盖 | comparison.test.ts 验证两版对相同输入产生相同结果 |

### 5.3 Pinocchio 版指令路由

```rust
// Pinocchio 版使用 1 字节指令标识
entrypoint!(process_instruction);

fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (instruction, rest) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match instruction {
        0 => create_vesting(program_id, accounts, rest),
        1 => deposit(program_id, accounts, rest),
        2 => claim(program_id, accounts, rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
```

---

## 6. 安全架构（Security Architecture）

### 6.1 威胁模型

| 威胁 | 攻击向量 | 防御机制 |
| --- | --- | --- |
| 未授权提取 | 攻击者伪造 admin/beneficiary 身份 | 指令入口校验 signer 与 Account 字段一致 |
| Vault 资产窃取 | 攻击者直接操作 Vault | Vault owner 为 PDA（无私钥），仅可通过 invoke_signed 操作 |
| 参数篡改 | 攻击者修改 Vesting 参数 | Account 字段创建后不可变（released_amount 除外） |
| 超额释放 | 释放计算错误导致多领 | checked 运算 + 向下取整 + released_amount 单调递增 |
| 重入攻击 | CPI 回调修改状态 | Solana 运行时保证同一 Account 不可被并发修改 |
| 伪造 PDA | 攻击者提供假的 Vesting Account | Anchor 自动校验 PDA seeds；Pinocchio 手动 find_program_address |
| 整数溢出 | total_amount * elapsed 溢出 u64 | 使用 u128 中间计算 + checked 运算 |

---

### 6.2 访问控制矩阵

| 操作 | 任何人 | Admin | Beneficiary | Program (PDA) |
| --- | --- | --- | --- | --- |
| create_vesting | Signer 即为 Admin | - | - | - |
| deposit | - | 仅限此 Vesting 的 admin | - | - |
| claim | - | - | 仅限此 Vesting 的 beneficiary | - |
| 操作 Vault | - | - | - | 仅通过 invoke_signed |
| 读取 Account | 任何人 | 任何人 | 任何人 | - |
| 修改参数 | - | - | - | 不可修改 |

---

### 6.3 安全检查清单

每条指令必须在入口处完成以下校验：

**create_vesting**
- [ ] `total_amount > 0`
- [ ] `start_time <= cliff_time <= end_time`
- [ ] `start_time < end_time`
- [ ] PDA seeds 正确派生
- [ ] Vault ATA 初始化正确（owner = PDA, mint = mint）

**deposit**
- [ ] `signer == vesting.admin`
- [ ] `vault.amount == 0`（未重复 deposit）
- [ ] `admin_token_account.mint == vesting.mint`
- [ ] 转账金额 == `vesting.total_amount`

**claim**
- [ ] `signer == vesting.beneficiary`
- [ ] `vault.amount > 0`（已 deposit）
- [ ] `claimable > 0`
- [ ] `beneficiary_token_account.mint == vesting.mint`
- [ ] 更新后 `released_amount <= total_amount`

---

## 7. 部署架构（Deployment Architecture）

### 7.1 环境规划

| 环境 | 用途 | RPC Endpoint | Program 部署 |
| --- | --- | --- | --- |
| Localnet | 本地开发测试 | http://localhost:8899 | `solana-test-validator` |
| Devnet | 联调与 Demo | https://api.devnet.solana.com | `anchor deploy --provider.cluster devnet` |
| Testnet | 预发布验证 | https://api.testnet.solana.com | 手动部署 |
| Mainnet-Beta | 生产环境 | https://api.mainnet-beta.solana.com | 审计后部署 |

### 7.2 部署流程

```
开发 → 本地测试 → Devnet 部署 → 集成测试 → (可选: 审计) → Mainnet 部署
       ▲                                           │
       └───── 发现问题，回退修复 ◄──────────────────┘
```

### 7.3 Program ID 管理

```toml
# Anchor.toml
[programs.localnet]
anchor_vesting = "VestXXX...anchor"

[programs.devnet]
anchor_vesting = "VestXXX...anchor"

[programs.mainnet]
anchor_vesting = "VestXXX...anchor"
```

* 两套 Program 使用**不同的 Program ID**
* 前端通过环境变量配置 Program ID：`NEXT_PUBLIC_VESTING_PROGRAM_ID`

---

## 8. 测试架构（Testing Architecture）

### 8.1 测试分层

```
┌───────────────────────────────────────────┐
│          E2E Tests (手动 / 半自动)          │  前端 + 链上完整流程
├───────────────────────────────────────────┤
│       Integration Tests (TypeScript)      │  Program 指令 + 状态验证
│       anchor-vesting.test.ts              │
│       pinocchio-vesting.test.ts           │
│       comparison.test.ts                  │
├───────────────────────────────────────────┤
│          Unit Tests (Rust)                │  释放计算、序列化等纯函数
│          #[cfg(test)] mod tests           │
└───────────────────────────────────────────┘
```

### 8.2 测试环境

| 层 | 工具 | 说明 |
| --- | --- | --- |
| Rust 单元测试 | `cargo test` | 测试纯计算逻辑（calculate_released 等） |
| 集成测试 | `anchor test` + Bankrun / solana-test-validator | 测试完整指令流 |
| 时间模拟 | `Clock` sysvar warp | 使用 `context.warp_to_slot()` 或 Bankrun 时间推进 |
| 前端测试 | 手动测试 + Devnet | 验证 UX 流程 |

### 8.3 时间测试策略

Vesting 的核心逻辑依赖时间，测试中需要模拟时间推进：

```typescript
// 使用 Bankrun 或 solana-test-validator 的 clock warp
async function advanceTimeTo(context: BankcunContext, targetTimestamp: number) {
    const currentClock = await context.banksClient.getClock();
    const targetSlot = currentClock.slot + BigInt(
        Math.ceil((targetTimestamp - Number(currentClock.unixTimestamp)) / 0.4)
    );
    context.setClock(new Clock(
        targetSlot,
        /* epochStartTimestamp */ BigInt(0),
        /* epoch */ BigInt(0),
        /* leaderScheduleEpoch */ BigInt(0),
        /* unixTimestamp */ BigInt(targetTimestamp),
    ));
}
```

---

## 9. 性能预估（Performance Estimation）

### 9.1 CU 消耗预估

| 指令 | Anchor 版 (预估) | Pinocchio 版 (预估) | 说明 |
| --- | --- | --- | --- |
| create_vesting | ~50,000 CU | ~20,000 CU | Account 初始化 + ATA 创建 |
| deposit | ~30,000 CU | ~10,000 CU | SPL Token Transfer |
| claim | ~35,000 CU | ~12,000 CU | 释放计算 + SPL Transfer |

> 以上为估算值，实际以部署后 `solana confirm -v` 测量为准。
> Solana 单交易 CU 上限为 1,400,000，所有指令远低于上限。

### 9.2 Account 租金成本

```
Vesting Account: 153 bytes → ~0.00178 SOL rent-exempt
Vault (ATA):     165 bytes → ~0.00204 SOL rent-exempt
──────────────────────────────────────────────────
每个 Vesting 总成本: ~0.00382 SOL (约 $0.50 @ $130/SOL)
```

---

## 10. 文档关系与追溯矩阵

### 10.1 三份文档的关系

```
PROJECT_PROPOSAL.md          SRS.md                ARCHITECTURE.md
(为什么做)                   (做什么)               (怎么构建)
─────────────────           ──────────             ────────────────
市场背景             →      BR-1~BR-5      →      指令处理流程
产品定位             →      FR-1~FR-7      →      Account 数据模型
竞品分析             →      NFR-1~NFR-4    →      安全架构
商业模式             →      FE-1~FE-7      →      前端组件架构
风险评估             →      TR-1~TR-5      →      测试架构
演进路径             →      可选增强        →      扩展性预留
```

### 10.2 需求 → 架构追溯

| SRS 需求 | 架构映射 |
| --- | --- |
| BR-1 创建锁仓 | 2.4.1 create_vesting 流程 |
| BR-2 资产托管 | 2.3 PDA 派生 + 2.5 CPI 设计 |
| BR-3 释放规则 | 2.6 释放计算算法 |
| BR-4 用户领取 | 2.4.3 claim 流程 |
| BR-5 状态查询 | 2.2 Account 数据模型 |
| FR-2 Vesting Account | 2.2.1 结构定义 + 2.2.2 字节布局 |
| FR-7 错误码 | 2.7 错误处理架构 |
| NFR-1 安全性 | 6. 安全架构（威胁模型 + 访问控制） |
| NFR-4 性能 | 9. 性能预估 |
| FE-1~FE-7 前端 | 3. 前端架构 |
| TR-1~TR-5 测试 | 8. 测试架构 |
| SRS §8 Pinocchio | 5. Anchor vs Pinocchio 对比架构 |
