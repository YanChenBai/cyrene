# 发版流程

包版本从 `0.0.0` 开始，当前处于 `beta` 模式。发布版本由新增 changeset 的版本类型决定。

## 1. 记录变更

```sh
vp run changeset
```

选择受影响的包和版本类型，填写面向使用者的说明。这段 summary 会进入 CHANGELOG、发版 PR 和 GitHub Release。
仓库未预置首次发布的 changeset，需要自行创建。若首次发布目标是 `1.0.0-beta.0`，为需要发布的包选择 `major`。

## 2. 检查并合入 main

```sh
vp install
vp run -r build
vp check
vp test run
vp run changeset status
```

提交 changeset 并将改动合入 `main`。GitHub Actions 会创建或更新版本 PR，包含版本号、CHANGELOG、锁文件和发布说明。

## 3. 合并版本 PR

检查包版本与说明后合并版本 PR。工作流会发布 npm 包并更新 GitHub Release，beta 版本使用 npm 的 `beta` 标签。

发布说明更新失败时，重跑失败的 `release-notes` job 即可，不必重新发布 npm。

## 发布正式版

准备好退出 beta 时运行并提交：

```sh
vp exec changeset pre exit
```

随后按同样流程合入 `main`，检查并合并正式版的版本 PR。

## 首次发布前

- 在 npm 完成新包的首次发布及 Trusted Publisher 配置，关联 `YanChenBai/cyrene` 的 `release.yml`。
- 在 GitHub 仓库中允许 Actions 创建 PR。
- `vp run version-packages` 会修改版本，`vp run release` 会发布 npm；日常开发无需手动执行。
