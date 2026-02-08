# Secure Token Vesting & Escrow DApp — 安全测试报告

> **报告生成日期**: 2026-02-08
> **安全需求来源**: SRS NFR-1 + Architecture §6（安全架构）
> **测试范围**: Anchor Program (anchor-vesting) + Pinocchio Program (pinocchio-vesting)
> **测试环境**: solana-test-validator (Localnet), agave-validator 3.1.7

---

## 1. 安全测试摘要

| 指标 | 数值 |
| --- | --- |
| 安全测试用例总数 | **28** |
| 通过 | **28** |
| 失败 | 0 |
| 风险等级覆盖 | 高/中/低 全覆盖 |
| 威胁模型覆盖率 | **7/7 = 100%** |
| 数据不变量覆盖率 | **7/7 = 100%** |
| 安全检查清单通过率 | **14/14 = 100%** |

> 安全测试用例包括: Security Suite (16) + Anchor 安全测试 (7) + Pinocchio 安全测试 (5)

---

## 2. 威胁模型验证（Architecture §6.1）

### 2.1 威胁对照表

| # | 威胁 | 风险等级 | 攻击向量 | 防御机制 | 测试用例 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| TH-1 | 未授权提取 | **高** | 攻击者伪造 admin/beneficiary 身份 | 指令入口校验 signer 与 Account 字段一致 | T-20, T-21, SEC-2.1, SEC-2.2, SEC-2.3 | **PASS** |
| TH-2 | Vault 资产窃取 | **高** | 攻击者直接操作 Vault | Vault owner 为 PDA（无私钥），仅可通过 invoke_signed 操作 | SEC-1.1, SEC-1.3 | **PASS** |
| TH-3 | 参数篡改 | **高** | 攻击者修改 Vesting 参数 | Account 字段创建后不可变 | SEC-3.6 | **PASS** |
| TH-4 | 超额释放 | **高** | 释放计算错误导致多领 | checked 运算 + 向下取整 + released_amount 单调递增 | T-03, T-04, T-05, SEC-3.1, SEC-3.4 | **PASS** |
| TH-5 | 重入攻击 | **中** | CPI 回调修改状态 | Solana 运行时保证同一 Account 不可被并发修改 | 运行时保证 (\*1) | **N/A** |
| TH-6 | 伪造 PDA | **中** | 攻击者提供假的 Vesting Account | Anchor 自动校验 PDA seeds；Pinocchio 手动 find_program_address | SEC-4.1, SEC-4.2 | **PASS** |
| TH-7 | 整数溢出 | **中** | total_amount \* elapsed 溢出 u64 | 使用 u128 中间计算 + checked 运算 | T-35, SEC-6.1 | **PASS** |

> \*1: 重入攻击 (TH-5) 由 Solana 运行时的单一写锁机制天然防御，无需特殊测试。Solana 保证同一 Account 在一个交易中不会被多个指令并发修改。

**威胁模型覆盖率: 7/7 = 100%（6 实测 + 1 运行时保证）**

---

## 3. 访问控制矩阵验证（Architecture §6.2）

### 3.1 操作权限验证

| 操作 | 授权角色 | 非授权测试 | 结果 |
| --- | --- | --- | --- |
| create_vesting | 任何 Signer（即为 admin） | SEC-4.2 (PDA seeds 不匹配) | **拒绝** ✅ |
| deposit | 仅此 Vesting 的 admin | T-20 (非 admin), SEC-2.1 (attacker) | **拒绝** ✅ |
| claim | 仅此 Vesting 的 beneficiary | T-21 (非 beneficiary), SEC-2.2 (attacker), SEC-2.3 (admin) | **拒绝** ✅ |
| 操作 Vault | 仅 Program (PDA invoke_signed) | SEC-1.3 (直接 SPL transfer) | **拒绝** ✅ |
| 读取 Account | 任何人 | SEC-7.1 (跨 Program 读取) | **允许** ✅ |
| 修改参数 | 不可修改 | SEC-3.6 (immutability check) | **不可变** ✅ |

### 3.2 角色隔离测试

| 场景 | 测试用例 | 结果 |
| --- | --- | --- |
| Admin 不能 Claim | SEC-2.3 | **拒绝** ✅ |
| Beneficiary 不能 Deposit | T-20 (作为非 admin) | **拒绝** ✅ |
| 第三方 Attacker 不能 Deposit | SEC-2.1 | **拒绝** ✅ |
| 第三方 Attacker 不能 Claim | SEC-2.2 | **拒绝** ✅ |

---

## 4. 资产安全验证（NFR-1 §5.1.1）

### 4.1 Token 托管安全

| 安全要求 | 测试用例 | 验证方式 | 状态 |
| --- | --- | --- | --- |
| Token 只能通过 Program 指令转移 | SEC-1.3 | 尝试直接 SPL transfer 失败 | ✅ |
| Vault owner 为 PDA，无私钥 | SEC-1.1 | 验证 vault.owner == vestingPda | ✅ |
| Admin 存入后不可取回（单向托管） | T-22, SEC-5.2 | 重复 deposit 失败；无 withdraw 指令 | ✅ |
| Vault 余额与链上状态一致 | SEC-1.2, SEC-3.4 | vault.amount == total_amount - released_amount | ✅ |

### 4.2 防 Rug Pull 机制

| 机制 | 说明 | 验证 |
| --- | --- | --- |
| 无 withdraw 指令 | 合约不提供任何取回 Token 的指令 | 代码审查确认 ✅ |
| 参数不可修改 | 创建后所有参数（含 end_time）不可篡改 | SEC-3.6 ✅ |
| PDA 控制 Vault | 无人持有 Vault 的私钥 | SEC-1.1 ✅ |
| released_amount 单调递增 | 不可回退已释放状态 | T-05, SEC-3.1 ✅ |

---

## 5. 数据完整性验证（NFR-1 §5.1.3 + Architecture §2.2.3）

### 5.1 不变量验证

| 不变量 | 公式 | 测试用例 | 状态 |
| --- | --- | --- | --- |
| INV-1 | `released_amount ≤ total_amount` | SEC-3.1 | ✅ |
| INV-2 | `start_time ≤ cliff_time ≤ end_time` | SEC-3.2 | ✅ |
| INV-3 | `start_time < end_time` | SEC-3.2 | ✅ |
| INV-4 | `total_amount > 0` | SEC-3.3 | ✅ |
| INV-5 | `vault.amount == total_amount - released_amount` | SEC-3.4, T-03 | ✅ |
| INV-6 | `vault.owner == vesting_pda` | SEC-3.5, SEC-1.1 | ✅ |
| INV-7 | `vault.mint == vesting.mint` | SEC-3.5 | ✅ |

### 5.2 字段不可变性验证

| 字段 | 可变性 | 验证方式 | 状态 |
| --- | --- | --- | --- |
| admin | 创建后不可修改 | SEC-3.6 (claim 前后对比) | ✅ |
| beneficiary | 创建后不可修改 | SEC-3.6 | ✅ |
| mint | 创建后不可修改 | SEC-3.6 | ✅ |
| total_amount | 创建后不可修改 | SEC-3.6 | ✅ |
| start_time | 创建后不可修改 | SEC-3.6 | ✅ |
| cliff_time | 创建后不可修改 | SEC-3.6 | ✅ |
| end_time | 创建后不可修改 | SEC-3.6 | ✅ |
| seed | 创建后不可修改 | SEC-3.6 | ✅ |
| bump | 创建后不可修改 | SEC-3.6 | ✅ |
| released_amount | 仅 Claim 时递增 | SEC-3.1, T-05 | ✅ |

---

## 6. PDA 安全验证

### 6.1 PDA 派生确定性

| 测试 | 说明 | 状态 |
| --- | --- | --- |
| SEC-4.1 | 从公开种子重新派生 PDA，与链上地址一致 | ✅ |
| SEC-4.2 | 使用错误种子创建 PDA 失败（Anchor 自动校验） | ✅ |
| T-40 (comparison) | Anchor 和 Pinocchio 使用相同种子派生相同 PDA | ✅ |

### 6.2 PDA 种子安全性分析

```
seeds = ["vesting", beneficiary.key, mint.key, seed.to_le_bytes()]
```

| 安全属性 | 分析 | 结论 |
| --- | --- | --- |
| 命名空间隔离 | `b"vesting"` 前缀防止与其他 PDA 冲突 | ✅ 安全 |
| 唯一性 | 四元组 (vesting, beneficiary, mint, seed) 确保唯一 | ✅ 安全 |
| 不可预测性 | 基于 SHA256 hash，不可逆推 | ✅ 安全 |
| 跨 Program 隔离 | 不同 Program ID 产生不同 PDA | ✅ 安全（T-40 验证） |

---

## 7. 幂等性与防重放验证（BR-4）

| 场景 | 测试用例 | 结果 |
| --- | --- | --- |
| 重复创建同一 PDA | SEC-5.1 | **拒绝**（Account already initialized）✅ |
| 重复 Deposit | T-22, SEC-5.2 | **拒绝**（AlreadyFunded）✅ |
| 重复 Claim（无新增释放） | T-14 | **拒绝**（NothingToClaim / NotFunded）✅ |
| 连续两次 Claim（有新增释放） | T-05 | **允许**（正确增量）✅ |

---

## 8. 整数安全验证

### 8.1 溢出防护

| 运算 | 风险 | 防护措施 | 测试 | 状态 |
| --- | --- | --- | --- | --- |
| `total_amount * elapsed` | u64 × u64 溢出 | 使用 u128 中间变量 | T-35, SEC-6.1 | ✅ |
| `released + claimable` | 加法溢出 | `checked_add()` | Anchor claim 代码 | ✅ |
| `now - start_time` | 减法下溢 | cliff_time 前返回 0 | T-10 | ✅ |
| 整数除法精度 | 向上取整超额释放 | 整数除法天然向下取整 | T-03 (partial), SEC-3.1 | ✅ |

### 8.2 大数测试

| 测试值 | 用途 | 测试用例 | 结果 |
| --- | --- | --- | --- |
| `total_amount = 10^18` | 接近 u64 上限的大额测试 | T-35 | PASS ✅ |
| `total_amount = 9 × 10^18` | u128 乘法中间值测试 | SEC-6.1 | PASS ✅ |
| `total_amount = 1` | 最小值边界 | T-34 | PASS ✅ |
| `total_amount = 0` | 零值拒绝 | T-30 | 被拒绝 ✅ |

---

## 9. 跨实现安全一致性（Anchor vs Pinocchio）

### 9.1 功能一致性

| 检查项 | Anchor | Pinocchio | 一致性 |
| --- | --- | --- | --- |
| PDA 种子 | 相同 | 相同 | ✅ |
| Account 数据布局 | 8B discriminator + 145B data | 145B data (无 discriminator) | ✅ (偏移已知) |
| 释放计算逻辑 | u128 safe math | u128 safe math | ✅ |
| 错误处理 | Anchor error codes | ProgramError variants | ✅ |
| 创建后 Account 状态 | T-40 对比验证 | T-40 对比验证 | ✅ |

### 9.2 数据互操作性

| 测试 | 说明 | 状态 |
| --- | --- | --- |
| SEC-7.1 | 跳过 8B discriminator 后手动解析 Anchor 创建的 Account | ✅ |
| T-40 | 比较两套 Program 对相同输入产生的 Account 数据 | ✅ |
| T-41 | CU 消耗差异记录（非安全问题，仅性能差异） | ✅ |

---

## 10. 安全检查清单（Architecture §6.3）

### create_vesting

| 检查项 | 状态 | 验证 |
| --- | --- | --- |
| `total_amount > 0` | ✅ | T-30 |
| `start_time <= cliff_time <= end_time` | ✅ | T-31, T-32 |
| `start_time < end_time` | ✅ | T-33 |
| PDA seeds 正确派生 | ✅ | SEC-4.1, SEC-4.2 |
| Vault ATA 初始化正确 | ✅ | T-01, SEC-3.5 |

### deposit

| 检查项 | 状态 | 验证 |
| --- | --- | --- |
| `signer == vesting.admin` | ✅ | T-20, SEC-2.1 |
| `vault.amount == 0` | ✅ | T-22, SEC-5.2 |
| `admin_token_account.mint == vesting.mint` | ✅ | Anchor 约束层 |
| 转账金额 == `vesting.total_amount` | ✅ | 设计保证（无参数传入） |

### claim

| 检查项 | 状态 | 验证 |
| --- | --- | --- |
| `signer == vesting.beneficiary` | ✅ | T-21, SEC-2.2, SEC-2.3 |
| `vault.amount > 0` | ✅ | T-25 |
| `claimable > 0` | ✅ | T-10, T-14 |
| `beneficiary_token_account.mint == vesting.mint` | ✅ | Anchor 约束层 |
| 更新后 `released_amount <= total_amount` | ✅ | SEC-3.1 |

**安全检查清单通过率: 14/14 = 100%**

---

## 11. 安全评估结论

### 11.1 总体评级

| 维度 | 评级 | 说明 |
| --- | --- | --- |
| 资产安全 | **A** | PDA 控制 Vault，无私钥泄露风险，无 withdraw 指令 |
| 访问控制 | **A** | 严格的 admin/beneficiary 角色隔离，全部通过测试 |
| 数据完整性 | **A** | 7 项不变量全部验证通过，参数不可篡改 |
| 计算安全 | **A** | u128 安全运算，向下取整，checked 数学 |
| 防重放 | **A** | PDA 唯一性 + AlreadyFunded + NothingToClaim |
| 跨实现一致性 | **A** | Anchor 与 Pinocchio 数据格式互操作，状态一致 |

### 11.2 已知风险与缓解

| 风险 | 严重程度 | 状态 | 缓解措施 |
| --- | --- | --- | --- |
| Vesting 不可撤销 | **低**（设计决策） | **已知** | SRS 明确规定为不可撤销设计；可选增强中提到了 Revocable Vesting |
| 无事件日志 | **低** | **已知** | SRS 可选增强中提到 Anchor Events；不影响核心安全性 |
| 精确到秒的时间测试覆盖不足 | **低** | **已知** | 建议集成 Bankrun 进行精确 Clock warp 测试 |
| 未经第三方审计 | **中** | **待处理** | 建议 Mainnet 部署前进行专业安全审计 |

### 11.3 安全建议

1. **Mainnet 部署前**: 进行第三方安全审计（推荐 Neodyme、OtterSec、Trail of Bits）
2. **增强监控**: 添加 Anchor Events 日志，支持链下安全监控
3. **时间测试**: 集成 Bankrun 实现精确的 Clock warp 测试
4. **模糊测试**: 引入 Property-Based Testing / Fuzzing 验证释放计算的数学正确性
5. **限流**: 考虑添加每 slot 的 claim 频率限制（防止资源滥用）

---

## 附录 A：安全测试用例清单

### 专项安全测试 (security.test.ts)

| 编号 | 类别 | 测试名称 | 结果 |
| --- | --- | --- | --- |
| SEC-1.1 | 资产安全 | Vault owner is PDA (no private key) | PASS |
| SEC-1.2 | 资产安全 | Vault balance matches total_amount after deposit | PASS |
| SEC-1.3 | 资产安全 | Direct SPL transfer from vault fails | PASS |
| SEC-2.1 | 访问控制 | Attacker cannot deposit into someone else's vesting | PASS |
| SEC-2.2 | 访问控制 | Attacker cannot claim someone else's vesting | PASS |
| SEC-2.3 | 访问控制 | Admin cannot claim (role separation) | PASS |
| SEC-3.1 | 数据完整性 | INV-1: released_amount <= total_amount | PASS |
| SEC-3.2 | 数据完整性 | INV-2/3: time range invariant preserved | PASS |
| SEC-3.3 | 数据完整性 | INV-4: total_amount > 0 invariant holds | PASS |
| SEC-3.4 | 数据完整性 | INV-5: vault.amount == total_amount - released_amount | PASS |
| SEC-3.5 | 数据完整性 | INV-6/7: vault ownership and mint consistency | PASS |
| SEC-3.6 | 数据完整性 | Parameters are immutable after creation | PASS |
| SEC-4.1 | PDA 安全 | PDA is deterministic and verifiable | PASS |
| SEC-4.2 | PDA 安全 | Cannot create vesting with forged PDA | PASS |
| SEC-5.1 | 幂等性 | Cannot create same vesting PDA twice | PASS |
| SEC-5.2 | 幂等性 | Duplicate deposit on funded vesting fails | PASS |
| SEC-6.1 | 溢出防护 | u128 safe math with large amounts | PASS |
| SEC-7.1 | 互操作 | Pinocchio can parse Anchor-created account data | PASS |

### Anchor 安全测试 (anchor-vesting.test.ts)

| 编号 | 测试名称 | 结果 |
| --- | --- | --- |
| T-10 | Claim fails before cliff (NothingToClaim) | PASS |
| T-14 | Second claim after full release fails | PASS |
| T-20 | Non-admin cannot deposit | PASS |
| T-21 | Non-beneficiary cannot claim | PASS |
| T-22 | Duplicate deposit fails (AlreadyFunded) | PASS |
| T-25 | Claim before deposit fails (NotFunded) | PASS |
| T-35 | Large amount overflow protection | PASS |

### Pinocchio 安全测试 (pinocchio-vesting.test.ts)

| 编号 | 测试名称 | 结果 |
| --- | --- | --- |
| P-SEC-1 | Non-admin cannot deposit | PASS |
| P-SEC-2 | Duplicate deposit fails | PASS |
| P-SEC-3 | Claim fails before cliff | PASS |
| P-SEC-4 | Zero amount rejected | PASS |
| P-SEC-5 | Invalid time range rejected | PASS |
