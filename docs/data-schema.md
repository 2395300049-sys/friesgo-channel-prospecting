# 数据字段与更新方法

`data/canonical_accounts.json` 是20家公司及其开发信的主表。`data/market_model.json` 保存8国、6个渠道、来源标题/URL、贸易金额。研究报告的解释性文字保存在 `docs/market-research-2026-10-23.md`；新研究另存新日期版本。

## 客户字段

| 组别 | 字段与含义 |
|---|---|
| 身份 | `id` 稳定编号；`name` 公司全称；`display_name` 打印简称；`country`；`website`；`role`；`channel` |
| 联系 | `email` 公开业务邮箱；`phone` 电话及已核即时渠道；`address`；`person` 已披露姓名/职务或应转岗位；`alt` 备用入口 |
| 证据 | `fact` 已核公司事实；`product_url`、`contact_url`、`project_url`；`sources` 全部来源；`checked_on` 实际核验日期；`verification`；`evidence_grade` |
| 项目与功能 | `product` 适合讨论的本品；`scenario` 历史项目或明确应用；`project_status` 实际供货边界与未知 |
| 开发判断 | `angle` 切入推断；`ask` 首封目标；`risk` 合作障碍；`authority` 采购权限状态；`stage` 证据阶段 |
| 排序 | `components` 七项分数；`score` 合计；`priority` A/B联系优先组 |
| 信件 | `subject`、`english` 英文母稿；`chinese` 中文译文；`local_subject`、`local` 首选语言；`language` |
| 后续 | `next_action` 推荐联系动作；`owner` 待分配；`followup_date` 留空。实际跟进记录保存在私有工作副本。 |

ID沿用V01—V07、M01—M06、U01—U07，不因排序随意重编号。集团分支不重复。新客户替换时记录替换原因，并同步来源、信件、报告、打印简称及所有输出。

## 更新不是改日期

重新核读官方产品、联系、项目/代理页面后才更新 `checked_on`；记录变化和失败页面。旧记录若未重核则保留旧日期和未知状态。不要因运行生成脚本更新为今天。

国家和数量、贸易年份、项目事实、联系人职务、优先级和语言变化时，同步报告文字与生成脚本中的案例说明。当前构建器是本轮20客户案例的重建工具，不能只替换JSON就宣称适用于任意产品/国家。新研究助手须按当次数据修订案例文字和执行新一轮视觉验收。

## 来源保存范围

`evidence/trade/` 保存Comtrade查询参数及事实数据；`source-index.csv` 和 `contact_provenance_check.json` 保存来源对应。`capture-manifest.json` 保存本地核读捕获文件的URL、HTTP状态、字段、长度和SHA256，不附第三方网页全文。哈希仅便于比对原本地捕获，不证明网页内容独立真实或从未变化。

商业联系方式是公开入口，不证明采购权或投递成功。`contact_domain_mx.json` 为历史技术查询记录，不作为邮箱送达验证。`letter-review.json` 是字数/相似度提示，不能代替商业内容审读。

`deliverables/2026-10-23/manifest.json` 记录公开快照的文件哈希。Word只把原本机产品来源链接换为本仓库的产品边界页，正文和版式保持原验收稿；不包含本机路径。后续文件修改必须更新清单并说明变化。
