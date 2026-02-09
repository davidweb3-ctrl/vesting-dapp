# Devnet 功能测试指南

> 本指南介绍如何使用前端页面测试 Devnet 上部署的合约功能。

---

## 📋 前置要求

1. **钱包准备**
   - 安装 Phantom 或 Solflare 钱包扩展
   - 确保钱包连接到 Devnet（不是 Mainnet）
   - 钱包需要有足够的 Devnet SOL（至少 1-2 SOL）

2. **获取 Devnet SOL**
   ```bash
   # 方法 1: CLI Airdrop
   solana config set --url devnet
   solana airdrop 2 <你的钱包地址>
   
   # 方法 2: Web Faucet
   # 访问 https://faucet.solana.com
   # 输入你的钱包地址
   
   # 方法 3: Discord Faucet
   # 加入 https://discord.gg/solana
   # 在 #devnet-faucet 频道发送: !faucet <你的钱包地址>
   ```

3. **准备测试 Token**
   - 需要创建一个 SPL Token 用于测试
   - 或使用已有的 Devnet Token

---

## 🚀 启动前端

### 步骤 1: 安装依赖

```bash
cd app
pnpm install
```

### 步骤 2: 启动开发服务器

```bash
pnpm dev
```

前端将在 `http://localhost:3000` 启动。

### 步骤 3: 连接钱包

1. 打开浏览器访问 `http://localhost:3000`
2. 点击右上角的 "Select Wallet" 按钮
3. 选择 Phantom 或 Solflare
4. 确认连接 Devnet（钱包中切换到 Devnet 网络）

---

## 🧪 测试流程

### 测试 1: 创建锁仓计划（Create Vesting）

**页面**: `/create`

**步骤**:
1. 填写表单：
   - **Beneficiary**: 受益人钱包地址（可以是另一个钱包地址）
   - **Token Mint**: SPL Token 的 Mint 地址
   - **Total Amount**: 锁仓总量（例如：1000，注意：这里输入的是 token 数量，不是 lamports）
   - **Start Date**: 开始时间（选择过去的时间，例如：1 小时前）
   - **Cliff Date**: Cliff 结束时间（选择未来时间，例如：1 小时后）
   - **End Date**: 完全释放时间（选择更远的未来，例如：24 小时后）
   - **Seed**: 唯一标识（可以随机生成）

2. 点击 "Create Vesting"
3. 在钱包中确认交易
4. 等待交易确认（查看交易签名链接）

**预期结果**:
- 交易成功
- 显示交易签名，可点击查看 Solana Explorer
- Vesting Account 已创建

**验证**:
```bash
# 使用 CLI 验证
solana account <vesting_pda_address> --url devnet
```

---

### 测试 2: 存入 Token（Deposit）

**页面**: `/dashboard` 或 `/create`（如果创建后直接存入）

**前置条件**:
- 已完成创建锁仓计划
- 你的钱包中有足够的 Token（至少等于 total_amount）

**步骤**:
1. 在 Dashboard 中找到刚创建的 Vesting
2. 点击 "Deposit" 按钮
3. 在钱包中确认交易
4. 等待交易确认

**预期结果**:
- 交易成功
- Vault 余额 = total_amount
- Vesting 状态变为 "Funded"

**验证**:
```bash
# 检查 Vault 余额
spl-token accounts <mint_address> --owner <vesting_pda> --url devnet
```

---

### 测试 3: 查看锁仓列表（Dashboard）

**页面**: `/dashboard`

**功能**:
- 显示你作为 Admin 创建的所有 Vesting
- 显示你作为 Beneficiary 的所有 Vesting
- 显示每个 Vesting 的状态：
  - Initialized（已创建，未存入）
  - Funded（已存入，Cliff 未到）
  - Releasing（Cliff 已过，正在释放）
  - Completed（全部释放）

**验证点**:
- 列表正确显示
- 状态正确
- 可领取数量计算正确

---

### 测试 4: 领取 Token（Claim）

**页面**: `/claim` 或 `/dashboard`

**前置条件**:
- Vesting 已存入 Token
- Cliff 时间已过（或设置为过去时间进行测试）

**步骤**:
1. 切换到 Beneficiary 钱包（如果 Beneficiary 是另一个地址）
2. 在 Claim 页面或 Dashboard 中找到可领取的 Vesting
3. 查看 "Claimable" 数量
4. 点击 "Claim" 按钮
5. 在钱包中确认交易
6. 等待交易确认

**预期结果**:
- 交易成功
- Token 转入 Beneficiary 钱包
- Released Amount 增加
- Vault 余额减少

**验证**:
```bash
# 检查 Beneficiary 钱包余额
spl-token accounts <mint_address> --owner <beneficiary_address> --url devnet

# 检查 Vesting Account 的 released_amount
solana account <vesting_pda> --url devnet
```

---

## 🔍 测试场景

### 场景 1: 完整流程测试

1. **创建** → 创建锁仓计划
2. **存入** → 存入 Token
3. **等待** → 等待 Cliff 时间过去（或设置 Cliff 为过去时间）
4. **领取** → Beneficiary 领取部分 Token
5. **再次领取** → 等待一段时间后再次领取（验证线性释放）

### 场景 2: 边界测试

- **Cliff 前 Claim**: 应该失败或显示 "Nothing to Claim"
- **多次 Claim**: 验证每次 Claim 的增量正确
- **完全释放**: End 时间后 Claim，应该领取全部剩余 Token

### 场景 3: 多 Vesting 测试

- 为同一 Beneficiary 创建多个 Vesting（使用不同的 seed）
- 验证 Dashboard 正确显示所有 Vesting
- 验证每个 Vesting 独立运行

---

## 🐛 常见问题排查

### Q1: 钱包连接失败

**解决方案**:
- 确保钱包扩展已安装并启用
- 刷新页面重试
- 检查钱包是否连接到 Devnet

### Q2: 交易失败 "insufficient funds"

**解决方案**:
- 检查钱包 SOL 余额（需要支付交易费）
- 获取更多 Devnet SOL: `solana airdrop 2`

### Q3: "Program account does not exist"

**解决方案**:
- 确认前端连接到 Devnet（检查 Header 中的网络选择器）
- 确认 Program ID 正确：`BB1JtUxXtmDnb6L5qXUSfuvT18TggYuSLBzfmjoYFnb4`
- 检查 IDL.json 中的 address 是否正确

### Q4: Token 余额不足

**解决方案**:
- 确保钱包中有足够的 Token（至少等于 total_amount）
- 如果是新创建的 Token，需要先 mint 到你的钱包

### Q5: Claim 失败 "Nothing to Claim"

**可能原因**:
- Cliff 时间未到（检查时间设置）
- 已全部领取（检查 released_amount）
- Vesting 未存入 Token

---

## 📊 验证工具

### Solana Explorer

查看交易和账户：
- Anchor Program: https://explorer.solana.com/address/BB1JtUxXtmDnb6L5qXUSfuvT18TggYuSLBzfmjoYFnb4?cluster=devnet
- Pinocchio Program: https://explorer.solana.com/address/3XcZJ34qBmN2g9joSeVH2kBQkmh2ZVV3e6dRMb7TCq3h?cluster=devnet

### CLI 验证命令

```bash
# 切换到 Devnet
solana config set --url devnet

# 查看 Program
solana program show BB1JtUxXtmDnb6L5qXUSfuvT18TggYuSLBzfmjoYFnb4 --url devnet

# 查看 Vesting Account
solana account <vesting_pda> --url devnet

# 查看 Token 余额
spl-token accounts <mint_address> --url devnet
```

---

## 🎯 测试检查清单

- [ ] 钱包成功连接到 Devnet
- [ ] 钱包有足够的 Devnet SOL
- [ ] 成功创建 Vesting
- [ ] 成功存入 Token
- [ ] Dashboard 正确显示 Vesting 列表
- [ ] Cliff 后成功 Claim
- [ ] 多次 Claim 增量正确
- [ ] End 后 Claim 全部剩余 Token
- [ ] 错误处理正确（Cliff 前 Claim、余额不足等）

---

## 💡 测试技巧

1. **时间设置**: 为了快速测试，可以设置：
   - Start Time: 1 小时前
   - Cliff Time: 现在或 5 分钟后
   - End Time: 1 小时后

2. **使用两个钱包**: 
   - 钱包 A 作为 Admin（创建和存入）
   - 钱包 B 作为 Beneficiary（领取）
   - 这样可以完整测试权限隔离

3. **监控交易**: 
   - 在 Solana Explorer 中查看每笔交易
   - 检查交易日志和错误信息

4. **验证状态**: 
   - 使用 CLI 命令验证链上状态
   - 对比前端显示和链上实际数据

---

## 📝 测试报告模板

测试完成后，记录：

```
测试日期: YYYY-MM-DD
测试人员: XXX
网络: Devnet

测试结果:
- [ ] Create Vesting: PASS / FAIL
- [ ] Deposit: PASS / FAIL
- [ ] Claim: PASS / FAIL
- [ ] Dashboard: PASS / FAIL

发现的问题:
1. ...
2. ...

备注:
...
```
