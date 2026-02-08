# 《Secure Token Vesting & Escrow DApp》

## 软件需求规格说明书（Product & Acceptance Oriented SRS）

> 本文档是本项目的**开发与验收唯一标准文档**，与《产品立项说明书》配套使用。
> 立项说明书回答"为什么做"，本文档回答"做什么、怎么做、怎么验收"。

---

## 1. 项目概述（Project Overview）

### 1.1 项目名称

Secure Token Vesting & Escrow DApp

---

### 1.2 项目背景

#### 1.2.1 市场环境

Solana 生态在 2024-2025 年经历了爆发式增长：

* TVL 达 $350 亿（2023 年底仅 $30 亿）
* 年交易量 331 亿笔（同比增长 28%）
* 活跃开发者 17,708 人（同比增长 41%）
* Pump.fun 单平台部署 Token 超 539 万个

Token 分发是项目启动与长期运营的核心环节，常见场景包括：

* 团队与核心贡献者激励
* 投资人代币释放
* 顾问与合作方奖励
* 空投或激励计划的分期发放
* DePIN / RWA 项目的 Token 分配

#### 1.2.2 核心问题

若 Token 直接转入用户钱包，将导致：

* 无法约束 Token 使用时间
* 无法防止提前抛售
* 无法提供可审计的释放记录

当前 Solana 生态的 Vesting 现状更加剧了这一问题：

* **98.7% 的 Pump.fun Token 呈现 Rug Pull 特征**（Solidus Labs 2025 报告）
* 2025 年 9 月 Aquabot 项目通过**单方面修改 Vesting 条款**窃取 $465 万
* 绝大多数项目选择自研 Vesting，代码质量参差不齐，安全不可外部验证

因此，需要一个**链上可验证、由程序托管资产、按时间自动释放的 Vesting & Escrow 系统**。

---

### 1.3 项目目标

本项目旨在交付一个**可在 Solana 主链部署和使用的 Token Vesting 基础设施模块**，实现：

* Token 的链上托管（Escrow）—— Program 控制，非人控制
* 基于时间的锁仓与释放（Vesting）—— 规则链上固化，不可篡改
* 用户自主、按规则领取 Token —— 无需项目方人工操作
* 全流程链上可追溯与可审计 —— 任意第三方可验证

> **产品定位**：不是"平台"，不是"项目定制方案"，而是一个**可被项目方、DAO、Launchpad 复用的基础能力模块**。

---

### 1.4 项目范围（Scope）

#### 包含范围

* 单 Token 的 Vesting 管理
* 单受益人的锁仓计划（同一受益人可创建多个 Vesting）
* Cliff + Linear 释放模型
* Web 前端交互界面（独立 DApp 形态）
* Anchor + Pinocchio 两种合约实现（功能一致、交叉验证）

#### 不包含范围

* 多链支持（初期聚焦 Solana 原生优势）
* DAO 治理或多签权限管理
* 链下时间源或预言机
* 商业化运营后台
* Token 发行与铸造（Token 管理不依赖 Vesting Program）

---

### 1.5 术语定义（Glossary）

| 术语 | 定义 |
| --- | --- |
| Vesting | Token 按时间规则逐步释放的机制 |
| Cliff | 锁仓期内不释放任何 Token 的初始等待阶段 |
| Escrow | 由 Program 托管资产，非人控制的账户模式 |
| PDA | Program Derived Address，由 Program 种子派生的确定性地址 |
| Vault | 存放锁仓 Token 的 Program 控制账户 |
| Claim | Beneficiary 主动领取已释放 Token 的操作 |
| CU | Compute Unit，Solana 交易的计算资源消耗单位 |
| ATA | Associated Token Account，与钱包地址关联的标准 Token 账户 |

---

## 2. 业务角色与权限（Actors & Permissions）

| 角色 | 描述 | 权限边界 |
| --- | --- | --- |
| Project Owner (Admin) | 创建锁仓计划并存入 Token | 可执行 create_vesting、deposit；**不可**领取 Token、修改 Vesting 参数、从 Vault 取回 Token |
| Beneficiary | 锁仓计划的受益人 | 仅可执行 claim；**不可**创建或修改 Vesting |
| Program | 链上程序，负责托管与释放 Token | 通过 PDA 控制 Vault；仅在满足释放规则时转移 Token |
| Token Mint Authority | Token 发行方 | 仅参与 Token 初始化，与 Vesting Program 无交互 |

**关键安全约束**：

* Admin 创建 Vesting 后，**不可修改**任何参数（start_time、cliff_time、end_time、total_amount）
* Admin **不可**从 Vault 中取回已存入的 Token
* 任何角色都**不可**绕过 Program 直接操作 Vault

---

## 3. 业务需求（Business Requirements）

### BR-1 创建锁仓计划（Create Vesting）

系统必须支持 Project Owner 为指定 Beneficiary 创建锁仓计划。

**输入参数：**

| 参数 | 类型 | 说明 | 约束 |
| --- | --- | --- | --- |
| beneficiary | Pubkey | 受益人钱包地址 | 必须为合法 Solana 地址 |
| mint | Pubkey | 锁仓 Token 的 Mint | 必须为合法 SPL Token Mint |
| total_amount | u64 | 锁仓 Token 总量 | > 0 |
| start_time | i64 | 锁仓开始时间（Unix 时间戳） | ≤ cliff_time |
| cliff_time | i64 | Cliff 结束时间 | ≥ start_time 且 ≤ end_time |
| end_time | i64 | 完全释放时间 | ≥ cliff_time 且 > start_time |

**业务规则：**

* start_time ≤ cliff_time ≤ end_time
* end_time > start_time（释放周期不可为零）
* total_amount > 0
* 同一 beneficiary + mint 可存在多个 Vesting（通过唯一种子标识区分）
* 创建后参数不可修改

---

### BR-2 锁仓资产托管（Escrow）

系统必须保证：

* 锁仓 Token 存放于 Program 控制的 Vault 账户（PDA 为 owner）
* Token **不存在于** Admin 或 Beneficiary 钱包
* Token 在释放前**不可被任何角色转出**
* Vault 仅接受与 Vesting 指定 mint 匹配的 Token

---

### BR-3 释放规则（Vesting Logic）

系统需支持 **Cliff + Linear** 释放模型：

| 时间区间 | 释放规则 | 可领取数量 |
| --- | --- | --- |
| now < cliff_time | Cliff 期内，完全锁定 | 0 |
| cliff_time ≤ now < end_time | 线性释放 | total_amount × (now - start_time) / (end_time - start_time) - released_amount |
| now ≥ end_time | 全部释放 | total_amount - released_amount |

**关键约束：**

* 释放额度**仅由链上逻辑计算**，前端不得参与释放计算
* 所有时间基于 Solana 链上 `Clock::unix_timestamp`
* 计算结果必须处理整数除法的精度问题（向下取整，确保不超额释放）

---

### BR-4 用户领取（Claim）

Beneficiary 可在任意时间发起领取操作，系统需：

* 自动计算当前可领取额度（基于 BR-3 释放规则）
* 将可领取 Token 从 Vault 转入 Beneficiary 的 ATA
* 更新 released_amount（单调递增）
* 若可领取数量为 0，交易应失败并返回明确错误

**幂等性保证：**

* 连续两次 Claim，第二次若无新增可领取额度，应安全失败
* 不可重复领取、不可超额领取

---

### BR-5 锁仓状态查询

系统需支持通过链上 Account 数据查询以下信息：

| 查询项 | 计算方式 |
| --- | --- |
| 锁仓总量 | total_amount |
| 已释放数量 | released_amount |
| 当前可领取数量 | calculate_released(now) - released_amount |
| 剩余未释放数量 | total_amount - released_amount |
| 锁仓状态 | 根据 released_amount 与时间推导 |

---

## 4. 功能需求（Functional Requirements）

### FR-1 Token 管理

* 支持使用 web3.js / @solana/spl-token 创建 SPL Token
* 支持 Token Mint 与初始分发
* Token 管理逻辑**不依赖** Vesting Program（完全解耦）

---

### FR-2 Vesting Account 管理

系统必须创建并维护 Vesting Account（PDA），包含以下字段：

| 字段 | 类型 | 说明 | 可变性 |
| --- | --- | --- | --- |
| admin | Pubkey | 创建者（Project Owner） | 创建后不可修改 |
| beneficiary | Pubkey | 受益人 | 创建后不可修改 |
| mint | Pubkey | 锁仓 Token Mint | 创建后不可修改 |
| total_amount | u64 | 锁仓 Token 总量 | 创建后不可修改 |
| released_amount | u64 | 已释放数量 | 仅 Claim 时递增 |
| start_time | i64 | 锁仓开始时间 | 创建后不可修改 |
| cliff_time | i64 | Cliff 结束时间 | 创建后不可修改 |
| end_time | i64 | 完全释放时间 | 创建后不可修改 |
| seed | u64 | 唯一标识种子 | 创建后不可修改 |
| bump | u8 | PDA bump seed | 创建后不可修改 |

**字段说明：**

* `admin` 字段用于 deposit 指令的权限校验
* `seed` 字段用于支持同一 beneficiary + mint 创建多个 Vesting
* `released_amount` 为**单调递增**字段，初始值为 0
* Account 空间大小固定，创建时一次性分配

---

### FR-3 Vault Token Account

* 每个 Vesting 对应一个 Vault Token Account
* Vault 为 ATA，owner 为 Vesting PDA
* Vault **仅用于存放 Token**，不存储业务状态
* Vault 的 mint 必须与 Vesting Account 中的 mint 一致

---

### FR-4 Deposit Token

* 仅 `admin`（创建该 Vesting 的 Project Owner）可存入 Token
* 存入 Token 的 mint 必须与 Vesting 匹配
* 存入数量必须等于 total_amount
* 每个 Vesting 仅可 deposit 一次（Vault 余额从 0 变为 total_amount）
* Deposit 前 Vesting 状态为 Initialized，Deposit 后变为 Funded

---

### FR-5 计算可释放额度

系统需提供链上函数，根据当前时间计算已解锁数量：

```
fn calculate_released(now: i64, vesting: &VestingAccount) -> u64 {
    if now < vesting.cliff_time {
        return 0;
    }
    if now >= vesting.end_time {
        return vesting.total_amount;
    }
    // 线性释放
    let elapsed = (now - vesting.start_time) as u64;
    let duration = (vesting.end_time - vesting.start_time) as u64;
    vesting.total_amount
        .checked_mul(elapsed)
        .unwrap()
        .checked_div(duration)
        .unwrap()
}
```

**关键约束：**

* 使用 `checked_mul` / `checked_div` 防止溢出
* 整数除法向下取整，确保 `released ≤ total_amount`
* 可领取数量 = `calculate_released(now) - released_amount`

---

### FR-6 Claim Token

* 仅 `beneficiary` 可调用
* 调用时自动计算可领取数量
* 可领取数量 > 0 时：从 Vault 转出 Token 至 Beneficiary ATA，更新 released_amount
* 可领取数量 = 0 时：交易失败，返回 `NothingToClaim` 错误
* Claim 操作为幂等操作（重复调用不会产生副作用）
* 当 released_amount = total_amount 后，Vesting 状态变为 Completed

---

### FR-7 错误码定义

| 错误码 | 名称 | 触发条件 |
| --- | --- | --- |
| 6000 | InvalidTimeRange | start_time > cliff_time 或 cliff_time > end_time 或 start_time = end_time |
| 6001 | InvalidAmount | total_amount = 0 |
| 6002 | UnauthorizedAdmin | 非 admin 调用 deposit |
| 6003 | UnauthorizedBeneficiary | 非 beneficiary 调用 claim |
| 6004 | AlreadyFunded | Vault 已有余额，重复 deposit |
| 6005 | NotFunded | Vesting 未 deposit 即尝试 claim |
| 6006 | NothingToClaim | 当前可领取数量为 0（Cliff 期内或已全部领取） |
| 6007 | MintMismatch | 存入 Token 的 mint 与 Vesting 不匹配 |
| 6008 | DepositAmountMismatch | 存入数量不等于 total_amount |
| 6009 | Overflow | 数学运算溢出 |

---

## 5. 非功能需求（Non-Functional Requirements）

### NFR-1 安全性

#### 5.1.1 资产安全

* Token **只能通过 Program 指令**转移，不可被任何外部账户直接操作
* Vault 的 owner 为 PDA，**没有私钥**，无法被人工签名转出
* Admin 存入 Token 后，**不可取回**（单向托管）

#### 5.1.2 访问控制

* create_vesting：任何人可调用（signer 即为 admin）
* deposit：仅 admin 可调用（校验 vesting.admin == signer）
* claim：仅 beneficiary 可调用（校验 vesting.beneficiary == signer）

#### 5.1.3 数据完整性

* PDA 种子可验证，任何人可通过种子重新派生并验证地址
* released_amount **单调递增**，不可被减少或重置
* 所有参数创建后不可修改（除 released_amount）

#### 5.1.4 异常处理

* 所有异常情况返回明确错误码（见 FR-7）
* 使用 checked 数学运算，防止整数溢出
* 所有账户约束在指令入口处校验，不合法的交易提前失败

---

### NFR-2 去中心化

* 无人工干预释放流程
* 无中心化托管账户（Vault 由 PDA 控制）
* 所有规则链上执行，前端仅为展示层
* 即使前端下线，用户仍可通过 CLI / SDK 直接调用 Program 完成 Claim

---

### NFR-3 可审计性

* 所有锁仓信息链上可查（通过 Vesting Account 数据）
* Vault 余额与 Vesting 状态可交叉验证：`vault_balance = total_amount - released_amount`
* PDA 种子公开，任何人可独立计算并验证账户地址
* 两套实现（Anchor + Pinocchio）提供交叉验证能力

---

### NFR-4 性能与成本

* 所有指令为**固定执行路径**（无循环、无动态分配）
* Claim 操作为 **O(1) 复杂度**
* Compute Unit 消耗可预测，不因 Vesting 参数变化而波动
* Account 空间一次性分配，无后续 realloc

---

## 6. 链上合约需求（On-Chain Requirements）

### 6.1 Program 指令

| 指令 | 调用者 | 说明 | 前置状态 | 后置状态 |
| --- | --- | --- | --- | --- |
| create_vesting | Project Owner | 创建锁仓计划，初始化 Vesting Account 与 Vault | 无 | Initialized |
| deposit | Project Owner (admin) | 将 Token 转入 Vault | Initialized | Funded |
| claim | Beneficiary | 领取已释放的 Token | Funded | Releasing / Completed |

---

### 6.2 PDA 设计

#### Vesting PDA

```
seeds = ["vesting", beneficiary.key, mint.key, seed.to_le_bytes()]
```

* `seed` 为 u64 类型，由 Admin 在创建时指定
* 支持同一 beneficiary + mint 创建多个 Vesting

#### Vault PDA

```
seeds = [vesting_pda.key]  (ATA of Vesting PDA for the given mint)
```

* Vault 为 Vesting PDA 的 Associated Token Account
* owner 为 Vesting PDA，mint 与 Vesting Account 中的 mint 一致

---

### 6.3 状态流转

```
Initialized ──(deposit)──→ Funded ──(claim)──→ Releasing ──(claim, all released)──→ Completed
```

**状态定义（通过数据推导，非显式字段）：**

| 状态 | 判定条件 |
| --- | --- |
| Initialized | vault_balance = 0 且 released_amount = 0 |
| Funded | vault_balance = total_amount 且 released_amount = 0 |
| Releasing | 0 < released_amount < total_amount |
| Completed | released_amount = total_amount |

状态**不可回退**。

---

### 6.4 各指令账户约束

#### create_vesting

| 账户 | 类型 | 约束 |
| --- | --- | --- |
| admin | Signer, Mut | 支付 rent |
| beneficiary | AccountInfo | 不需要签名 |
| mint | Account\<Mint\> | — |
| vesting_account | PDA, Init | seeds 验证 |
| vault | ATA, Init | owner = vesting PDA, mint = mint |
| system_program | Program | — |
| token_program | Program | — |
| associated_token_program | Program | — |

#### deposit

| 账户 | 类型 | 约束 |
| --- | --- | --- |
| admin | Signer, Mut | admin == vesting.admin |
| admin_token_account | ATA | owner = admin, mint = vesting.mint |
| vesting_account | PDA, Mut | — |
| vault | ATA, Mut | owner = vesting PDA |
| token_program | Program | — |

#### claim

| 账户 | 类型 | 约束 |
| --- | --- | --- |
| beneficiary | Signer, Mut | beneficiary == vesting.beneficiary |
| beneficiary_token_account | ATA, Init_if_needed | owner = beneficiary, mint = vesting.mint |
| vesting_account | PDA, Mut | — |
| vault | ATA, Mut | owner = vesting PDA |
| token_program | Program | — |
| system_program | Program | 用于 init_if_needed |
| associated_token_program | Program | 用于 init_if_needed |

---

## 7. 前端需求（Frontend Requirements）

### FE-1 技术栈

* 框架：React / Next.js
* 钱包适配：@solana/wallet-adapter
* 链上交互：@solana/web3.js + Anchor Client

---

### FE-2 钱包支持

* Phantom
* Solflare
* 支持 Wallet Standard 的其他钱包

---

### FE-3 网络支持

* Devnet（开发调试）
* Testnet（集成测试）
* Mainnet-Beta（生产环境）
* 用户可在前端切换网络

---

### FE-4 创建锁仓页面（Admin 视角）

**功能：**

* 输入 beneficiary 地址、Token Mint、锁仓总量
* 设置 start_time、cliff_time、end_time（日期时间选择器）
* 实时展示释放曲线预览（仅展示，不参与链上计算）
* 提交 create_vesting + deposit（两步操作或合并为一次 UX 流程）

**输入校验（前端预校验）：**

* beneficiary 为合法 Solana 地址
* total_amount > 0
* start_time ≤ cliff_time ≤ end_time
* end_time > start_time
* Admin 钱包 Token 余额 ≥ total_amount

---

### FE-5 锁仓列表 / Dashboard

**展示字段：**

| 字段 | 说明 |
| --- | --- |
| Beneficiary | 受益人地址 |
| Token Mint | 锁仓 Token |
| Total Amount | 锁仓总量 |
| Released | 已释放数量 |
| Claimable | 当前可领取数量（前端读取链上数据计算展示） |
| Status | Initialized / Funded / Releasing / Completed |
| Time Progress | 可视化时间进度（start → cliff → end） |

**筛选能力：**

* 按当前连接钱包身份（Admin / Beneficiary）过滤
* 按状态过滤

---

### FE-6 Claim 页面（Beneficiary 视角）

* 展示该 Beneficiary 关联的所有 Vesting
* 显示每个 Vesting 的可领取数量
* 提供 Claim 按钮
* Claim 成功后实时刷新状态
* Cliff 期内禁用 Claim 按钮，提示"锁仓中，Cliff 结束时间为 XXXX"

---

### FE-7 交易反馈

* 交易发送后展示 loading 状态
* 交易成功：展示成功提示 + 交易签名链接（跳转 Solana Explorer）
* 交易失败：展示可读的错误信息（映射 FR-7 错误码）

---

## 8. Pinocchio 实现要求

### 8.1 功能一致性

系统需提供 Pinocchio（原生 Solana Program，不依赖 Anchor 框架）版本，实现与 Anchor 版本**完全一致的功能**：

* 相同的指令集（create_vesting、deposit、claim）
* 相同的 PDA 种子与派生逻辑
* 相同的释放计算逻辑
* 相同的错误码定义
* 相同的账户约束

### 8.2 验证目标

* 验证合约逻辑的**框架无关性**（核心逻辑不依赖 Anchor 宏）
* 对比 Anchor vs Pinocchio 的 **CU 消耗差异**
* 对比两种实现的**代码量与可维护性**

### 8.3 互操作性

* 两套 Program 使用**相同的 Account 结构与序列化格式**
* 同一个前端可以切换调用 Anchor 或 Pinocchio 版本的 Program

---

## 9. 测试需求（Testing Requirements）

### TR-1 功能测试（Happy Path）

| 编号 | 测试场景 | 预期结果 |
| --- | --- | --- |
| T-01 | 创建 Vesting（参数合法） | Vesting Account 初始化成功，字段正确 |
| T-02 | Deposit Token（admin 操作） | Vault 余额 = total_amount |
| T-03 | Cliff 后 Claim | Token 转入 Beneficiary ATA，released_amount 更新 |
| T-04 | End 后 Claim | 全部 Token 转入 Beneficiary ATA |
| T-05 | 多次 Claim（线性释放期间） | 每次 Claim 增量正确，released_amount 单调递增 |

---

### TR-2 时间逻辑测试

| 编号 | 测试场景 | 预期结果 |
| --- | --- | --- |
| T-10 | Cliff 前 Claim | 失败，返回 NothingToClaim |
| T-11 | Cliff 时刻 Claim | 成功，可领取 = 线性计算值 |
| T-12 | 释放中期 Claim | 成功，可领取 = 线性计算值 - 已释放 |
| T-13 | End 时刻 Claim | 成功，可领取 = total_amount - released_amount |
| T-14 | End 后多次 Claim | 第一次全额领取，第二次失败 NothingToClaim |

---

### TR-3 安全测试

| 编号 | 测试场景 | 预期结果 |
| --- | --- | --- |
| T-20 | 非 admin 调用 deposit | 失败，返回 UnauthorizedAdmin |
| T-21 | 非 beneficiary 调用 claim | 失败，返回 UnauthorizedBeneficiary |
| T-22 | 重复 deposit | 失败，返回 AlreadyFunded |
| T-23 | mint 不匹配的 deposit | 失败，返回 MintMismatch |
| T-24 | 存入数量不等于 total_amount | 失败，返回 DepositAmountMismatch |
| T-25 | 未 deposit 即 claim | 失败，返回 NotFunded |

---

### TR-4 边界测试

| 编号 | 测试场景 | 预期结果 |
| --- | --- | --- |
| T-30 | total_amount = 0 | 创建失败，返回 InvalidAmount |
| T-31 | start_time > cliff_time | 创建失败，返回 InvalidTimeRange |
| T-32 | cliff_time > end_time | 创建失败，返回 InvalidTimeRange |
| T-33 | start_time = end_time | 创建失败，返回 InvalidTimeRange |
| T-34 | total_amount = 1（最小值） | 创建成功，Claim 行为正确 |
| T-35 | total_amount = u64::MAX | 验证不溢出（取决于实现） |

---

### TR-5 Pinocchio 对比测试

| 编号 | 测试场景 | 预期结果 |
| --- | --- | --- |
| T-40 | Anchor vs Pinocchio 相同参数 | 两套 Program 产生相同 Account 状态 |
| T-41 | CU 消耗对比 | 记录并对比两套实现的 CU 消耗 |
| T-42 | 跨 Program 数据读取 | Anchor 创建的 Account 可被 Pinocchio 正确解析 |

---

## 10. 验收标准（Acceptance Criteria）

项目验收需逐项确认以下清单：

### AC-1 核心功能

- [ ] create_vesting 在本地验证器成功执行，Account 数据正确
- [ ] deposit 成功将 Token 转入 Vault
- [ ] claim 在 Cliff 后成功领取 Token，数量符合线性释放计算
- [ ] claim 在 End 后可领取全部剩余 Token
- [ ] 同一 beneficiary + mint 可创建多个 Vesting

### AC-2 安全性

- [ ] Token 在锁仓期间不可被非 Program 转移
- [ ] 非 admin 无法 deposit
- [ ] 非 beneficiary 无法 claim
- [ ] released_amount 单调递增，无法被重置
- [ ] 所有错误场景返回正确错误码

### AC-3 链上可验证性

- [ ] 任何人可通过 PDA 种子独立计算并验证 Vesting Account 地址
- [ ] Vault 余额 = total_amount - released_amount（可交叉验证）
- [ ] Vesting Account 数据可通过 Explorer 或 CLI 直接读取

### AC-4 前端

- [ ] 钱包连接正常（Phantom / Solflare）
- [ ] 创建锁仓流程完整可用
- [ ] Dashboard 正确展示 Vesting 列表与状态
- [ ] Claim 操作完整可用
- [ ] 交易成功/失败有明确反馈

### AC-5 Pinocchio

- [ ] Pinocchio 版本三条指令功能与 Anchor 版本一致
- [ ] CU 消耗对比数据已记录

### AC-6 工程交付物

- [ ] 所有核心指令可在本地验证器与 Devnet 成功执行
- [ ] 测试覆盖 TR-1 至 TR-5 全部用例
- [ ] 提供完整 Demo 演示（视频或文档）
- [ ] 项目文档（SRS + 立项说明书 + README）完整

---

## 11. 可选增强需求（Optional Enhancements）

以下为非核心需求，作为后续迭代方向，对应产品立项说明书中的 Phase 2/3 演进路径：

| 增强项 | 说明 | 产品价值 |
| --- | --- | --- |
| 可撤销 Vesting | Admin 可取消 Vesting 并取回未释放 Token | B2B 高级功能，可作为付费特性 |
| 多 Beneficiary Vesting | 一次创建多个受益人的 Vesting | 降低批量操作成本 |
| NFT Vesting 凭证 | 为每个 Vesting 铸造 NFT 作为凭证 | 提升可组合性与可转让性 |
| 可视化释放曲线 | 前端展示完整的释放时间线图表 | 提升用户体验与信任度 |
| SDK / API 化 | 提供 npm 包供第三方项目集成 | 生态级基础设施演进 |
| 事件日志 | 通过 Anchor Events 记录关键操作 | 提升可审计性，支持链下索引 |

---

## 12. 产品总结

本项目交付的是一个**真实可用的 Solana Token Vesting 基础设施模块**。

在 Solana 生态 TVL 达 $350 亿、年部署 Token 超 500 万个的市场背景下，Token 分发的安全性与标准化已成为刚需。本产品通过 Program 控制 Token 托管，基于链上时间规则实现安全、透明、可审计的 Token 释放流程，定位为**可被项目方、DAO、Launchpad 直接复用的基础能力模块**。

> 不是"做一个 Vesting 工具"，而是"让 Vesting 成为 Solana 的标准能力"。
