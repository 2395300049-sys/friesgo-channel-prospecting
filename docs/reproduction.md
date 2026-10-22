# 生成与验收

## 取回已验收文件

```bash
git clone https://github.com/2395300049-sys/friesgo-channel-prospecting.git
cd friesgo-channel-prospecting
python3 scripts/reproduce.py
```

Python 3.10及以上，仅用标准库。默认取优化后的v2快照到outputs/latest，附ZIP；不联网、不改核验日期。取原版用 `python3 scripts/reproduce.py --version v1`。两版均保存冻结输入，当前主数据变化不影响历史复现。

## 从当前数据生成

```bash
python3 scripts/build_current.py
```

输出到outputs/current。读取canonical_accounts、operating_model及所指审核、市场、推进、产品资料文本，统一生成档案、逐家TXT、Markdown、CSV、Word、客户Excel与一页打印Excel/PDF。先在临时目录构建并交叉检查，再整体替换目标；失败保留之前完整输出。

完整生成需要Codex依赖工具提供的Python、Node、@oai/artifact-tool、python-docx、lxml、pypdf和LibreOffice。表格运行时不是本仓库自带npm包，不能假装普通npm安装即可取得。字体首次按官方固定提交下载并校验，缓存于忽略的outputs/.fontcache。普通快照模式没有这些依赖。

可设置FRIESGO_PYTHON、FRIESGO_NODE、FRIESGO_NODE_MODULES、FRIESGO_SOFFICE指定运行时。`python3 scripts/reproduce.py --rebuild` 也进入完整构建链。旧 `--rebuild-word` 改为完整构建，避免只更新一种格式造成矛盾。

只检查和导出文字：`python3 scripts/build_current.py --text-only`。该模式不生成Office/PDF，不能作为完整交付。

## 新研究与排版的区别

生成器不查客户、不更新事实日期、不编写市场结论。新研究需按SKILL重新核实，更新主数据、经营模型及相应叙述。旧报告随包保留时须标明历史属性。不能仅换名字或报告日期就称为新研究。

旧build_word.py与build_workbook.mjs保留为v1制作记录，当前入口不再调用。当前构建器为build_current、build_current_word、build_current_workbook。打印构建器继续遵守20行、一页横版和160个空记录格。

## 检查命令

```bash
python3 scripts/validate.py
python3 scripts/current_model.py
python3 scripts/validate_release.py
python3 -m unittest discover -s tests -v
```

依次检查v1冻结字节及隐私路径、当前数据与经营条件、v2冻结包、变更传播及失败回滚等行为。完整构建后，使用同一环境运行 `python3 scripts/validate_current_outputs.py outputs/current` 核对Word、Excel、逐家草稿和打印结果。

## 视觉验收及发布

新build-validation默认记录visual_review为pending。结构检查不批准版式。新Word必须渲染并逐页查看；表格检查主要内容、长文字和公式；打印PDF确认1页、约297乘210mm、20行无截断及操作格空白。视觉通过后另记当次文件哈希、页数与检查范围，不能复制旧证明。

经核验的输出另存新日期或版本目录，再生成manifest，保留原快照。公共包只收最终文件、冻结输入与核验记录，不收预览图、第三方网页全文、私人路径、买方回复和真实业务日志。重新生成不等于联网更新，也不自动发送或发布。
