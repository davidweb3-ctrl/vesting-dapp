# 部署指南（Deployment Guide）

## Devnet 部署

### 前置要求

1. **Solana CLI 已安装**：`solana --version`
2. **Anchor CLI 已安装**：`anchor --version`
3. **钱包有足够 SOL**：Devnet 部署需要约 2-3 SOL

### 步骤 1: 切换到 Devnet

```bash
solana config set --url devnet
solana config get  # 验证配置
```

### 步骤 2: 获取 Devnet SOL

#### 方法 1: Solana CLI Airdrop（推荐）

```bash
solana airdrop 2
```

> ⚠️ **注意**：如果遇到 rate limit，请等待几分钟后重试，或使用其他方法。

#### 方法 2: Web Faucet

访问 https://faucet.solana.com，输入你的钱包地址：

```bash
solana address
# 复制输出的地址，在网页中输入
```

#### 方法 3: Discord Faucet

1. 加入 Solana Discord: https://discord.gg/solana
2. 在 `#devnet-faucet` 频道发送：`!faucet <你的钱包地址>`

### 步骤 3: 验证余额

```bash
solana balance
# 确保至少有 2 SOL
```

### 步骤 4: 部署合约

#### 方法 A: 使用部署脚本（推荐）

```bash
bash scripts/deploy-devnet.sh
```

#### 方法 B: 手动部署

**部署 Anchor 合约：**

```bash
# 确保已构建
anchor build

# 部署到 Devnet
anchor deploy --provider.cluster devnet
```

**部署 Pinocchio 合约：**

```bash
# 构建 Pinocchio 合约
cd pinocchio-vesting
cargo build-sbf
cd ..

# 部署到 Devnet
solana program deploy \
  --program-id pinocchio-vesting/target/deploy/pinocchio_vesting-keypair.json \
  pinocchio-vesting/target/deploy/pinocchio_vesting.so \
  --url devnet
```

### 步骤 5: 验证部署

```bash
# 检查 Anchor 程序
solana program show BB1JtUxXtmDnb6L5qXUSfuvT18TggYuSLBzfmjoYFnb4 --url devnet

# 检查 Pinocchio 程序
solana program show EzRUZpW3CsvnKzEUiF7fAPHyHWsv2D3ERR482BPKHwYk --url devnet
```

### 步骤 6: 更新前端配置（如需要）

如果前端需要连接到 Devnet，更新 `app/app/lib/program/index.ts` 中的 RPC endpoint：

```typescript
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
```

---

## Mainnet 部署

> ⚠️ **警告**：Mainnet 部署需要真实 SOL，且不可撤销。建议先进行安全审计。

### 前置要求

1. 完成 Devnet 测试验证
2. 进行第三方安全审计（推荐）
3. 准备足够的 SOL（约 2-3 SOL per program）

### 部署步骤

```bash
# 切换到 Mainnet
solana config set --url mainnet-beta

# 验证钱包地址和余额
solana address
solana balance

# 部署（与 Devnet 相同）
anchor deploy --provider.cluster mainnet-beta

# Pinocchio 部署
solana program deploy \
  --program-id pinocchio-vesting/target/deploy/pinocchio_vesting-keypair.json \
  pinocchio-vesting/target/deploy/pinocchio_vesting.so \
  --url mainnet-beta
```

---

## Program ID

### Devnet（已部署）

| Program | Program ID | 部署时间 |
| --- | --- | --- |
| Anchor Vesting | `BB1JtUxXtmDnb6L5qXUSfuvT18TggYuSLBzfmjoYFnb4` | 2026-02-08 |
| Pinocchio Vesting | `3XcZJ34qBmN2g9joSeVH2kBQkmh2ZVV3e6dRMb7TCq3h` | 2026-02-08 |

### Localnet（测试）

| Program | Program ID |
| --- | --- |
| Anchor Vesting | `BB1JtUxXtmDnb6L5qXUSfuvT18TggYuSLBzfmjoYFnb4` |
| Pinocchio Vesting | `EzRUZpW3CsvnKzEUiF7fAPHyHWsv2D3ERR482BPKHwYk` |

> **注意**：
> - Anchor 程序的 Program ID 在 Devnet 和 Localnet 上相同（使用相同的 keypair）
> - Pinocchio 程序的 Program ID 在 Devnet 和 Localnet 上不同，因为原生 Solana 程序的 Program ID 就是 keypair 的公钥
> - 测试文件中的 `EzRUZpW3CsvnKzEUiF7fAPHyHWsv2D3ERR482BPKHwYk` 是 Localnet 测试用的 keypair

---

## 常见问题

### Q: 部署失败 "insufficient funds"

**A**: 钱包余额不足。获取更多 SOL：
- Devnet: `solana airdrop 2` 或使用 Web faucet
- Mainnet: 从交易所或其他钱包转入

### Q: "Program account does not exist"

**A**: 程序尚未部署。先运行 `anchor deploy` 或 `solana program deploy`。

### Q: "Upgrade authority mismatch"

**A**: 程序已由其他钱包部署。需要：
1. 使用原始部署钱包，或
2. 使用 `solana program set-upgrade-authority` 转移权限

### Q: Anchor deploy 找不到程序

**A**: 检查 `Anchor.toml` 中的 `[programs.devnet]` 配置是否正确。

---

## 部署成本估算

| 操作 | Devnet | Mainnet (估算) |
| --- | --- | --- |
| Anchor 程序部署 | ~2 SOL | ~2 SOL ($260 @ $130/SOL) |
| Pinocchio 程序部署 | ~2 SOL | ~2 SOL ($260 @ $130/SOL) |
| 每个 Vesting Account | ~0.004 SOL | ~0.004 SOL ($0.52) |

> Mainnet 成本基于 2025 年 2 月的 SOL 价格估算。
