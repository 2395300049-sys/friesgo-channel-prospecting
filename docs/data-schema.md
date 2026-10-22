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
| 历史排序 | `components` 七项分数；`score` 合计；`priority` 仅v1历史A/B组，不决定当前行动 |
| 信件 | `subject`、`english` 英文母稿；`chinese` 中文译文；`local_subject`、`local` 首选语言；`language` |
| 后续 | `next_action` 推荐联系动作；`owner` 待分配；`followup_date` 留空。实际跟进记录保存在私有工作副本。 |

ID沿用V01—V07、M01—M06、U01—U07，不因排序随意重编号。集团分支不重复。新客户替换时记录替换原因，并同步来源、信件、报告、打印简称及所有输出。

## 更新不是改日期

重新核读官方产品、联系、项目/代理页面后才更新 `checked_on`；记录变化和失败页面。旧记录若未重核则保留旧日期和未知状态。不要因运行生成脚本更新为今天。

当前生成器按同一批账户导出MD、TXT、CSV、Word与Excel，不再以v1固定国家分配校验新输入。国家、语言、项目或排序变化时，还须人工同步市场与审核叙述；脚本不会编写新研究结论。完整新研究仍交付20家，打印约束不变。新输出必须重新视觉验收。

## v2经营字段

每个账户新增`review`：`queue`为P1小批验证/P2条件验证/P3暂缓；`fit`是功能相关程度；`entry_product`是当次讨论位置；`reason`为研究判断；`next_commitment`为首封目标；`unlock`和`stop`分别为解除与停止条件。`reviewed_on`是判断复审日，与原事实`checked_on`分开。

`stage`为S1至S7证据阶段；`authority_verified`与`demand_confirmed`须有各自凭据才能升级。`source_open`默认为null，不能从目录推断。`outreach_status`记录操作状态，与证据阶段独立。`quote_gates`逐项保存status、value和evidence；只有准入/文件适用性可用有理由及凭据的not_applicable，其他核心交易事实不得免除。即使条件齐，没有真实报价凭据也不能升级S6。私有业务事实不写回公共主表。

`data/operating_model.json`保存报告日期、20家约束、试验账户、资料清单、报价字段、指标口径和叙述文件位置。模板阈值是项目建议，不是成功率或行业标准。`data/archive/accounts-2026-10-23-v1.json`冻结原输入，供旧快照校验。

已审核快照内另存其输入JSON，后续当前数据更新不改变旧包。`build-validation.json`默认标记视觉待验；人工检查后另存当次visual-review.json并冻结manifest。

## 来源保存范围

`evidence/trade/` 保存Comtrade查询参数及事实数据；`source-index.csv` 和 `contact_provenance_check.json` 保存来源对应。`capture-manifest.json` 保存本地核读捕获文件的URL、HTTP状态、字段、长度和SHA256，不附第三方网页全文。哈希仅便于比对原本地捕获，不证明网页内容独立真实或从未变化。

商业联系方式是公开入口，不证明采购权或投递成功。`contact_domain_mx.json` 为历史技术查询记录，不作为邮箱送达验证。`letter-review.json` 是字数/相似度提示，不能代替商业内容审读。

`deliverables/2026-10-23/manifest.json` 记录公开快照的文件哈希。Word只把原本机产品来源链接换为本仓库的产品边界页，正文和版式保持原验收稿；不包含本机路径。后续文件修改必须更新清单并说明变化。
