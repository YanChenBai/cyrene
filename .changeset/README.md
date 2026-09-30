# 发版流程

使用 Changesets 标准流程：开发 PR 记录变更，自动生成 Release PR，合并 Release PR 后发布 npm 和 GitHub Release。
自定义脚本只负责 Release PR 的标题和正文排版。

## 1. 记录变更

运行 `vp run changeset`，选择受影响的包和版本类型，填写面向使用者的变更说明，并随开发代码一起提交。
这段说明会进入 CHANGELOG 和 Release PR。

当前使用 beta 模式。首次发布的 `first-beta` changeset 已在 main 中，目标为 `0.0.1-beta.0`，无需重复创建。

## CI 与发布顺序

`release.yml` 是统一入口，先调用 CI 进行构建、格式、类型和测试检查。检查失败时不会运行下游发布。

- PR：CI → Preview Packages。
- main 推送或手动运行：CI → Release 与 Preview Packages，两者在检查通过后并行执行。
- 下游任务使用独立 runner，因此安装依赖和构建仍按需执行，但不会重复运行检查和测试。
- npm 发布保持在 release.yml 中，Trusted Publisher 配置无需更换文件名。

## 2. 合入开发 PR

合入 main 后，Changesets Action 自动创建或更新 `changeset-release/main` 对应的 Release PR，包含版本号、CHANGELOG 和锁文件。
后续开发 PR 合入时，会持续更新同一个 Release PR。

工作流在版本更新前保存 Changesets 状态，再通过 `release-pr.ts` 更新官方 Action 创建的 PR 标题和正文。标题格式为 `release: 包名@版本号, 包名@版本号`，每个包使用自己的目标版本。脚本不创建 PR、不更新版本或推送分支。

## 3. 合并 Release PR

确认 Release PR 的版本号和发布说明后合并。工作流随后发布 npm 包并创建 GitHub Release。
beta 版本使用 npm 的 beta 标签。GitHub Release 使用 Changesets 默认内容。

## 配置与失败恢复

- 在仓库 Settings → Actions → General → Workflow permissions 中开启 Allow GitHub Actions to create and approve pull requests；工作流已声明 pull-requests: write。
- npm 首次发布及 Trusted Publisher 配置需提前完成，关联 YanChenBai/cyrene 的 release.yml。
- 创建 PR 失败时，修复权限后重跑工作流。不要手工重复升版本或添加相同 changeset。
- 本次迁移需要先合入新的工作流，再使用 main 上的 CI and Release → Run workflow；重跑旧运行仍会使用旧提交的工作流。
- 仅正文更新失败时，重跑工作流即可重新生成；版本和 PR 生命周期仍由 Changesets 管理。

## 预览 PR 标题和正文

在版本更新前保存状态，然后对已存在的 Release PR 预览：

```sh
vp exec changeset status --output .git/release-status.json
vp run release-pr --status .git/release-status.json --pr 123 --dry-run
```

省略 `--dry-run` 会更新该 PR 的标题和正文，需要 GitHub CLI 登录或 GH_TOKEN。日常发版不需要本地执行此脚本。

## 发布正式版

运行 `vp exec changeset pre exit` 并提交，随后按同样流程合入开发 PR、检查并合并正式版 Release PR。

## 本地验证

```sh
vp install
vp run -r build
vp check
vp test run
```
