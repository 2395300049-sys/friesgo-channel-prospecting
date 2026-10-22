# 生成与验收

## 取回本次已验收文件

```bash
git clone https://github.com/2395300049-sys/friesgo-channel-prospecting.git
cd friesgo-channel-prospecting
python3 scripts/reproduce.py
```

仅需Python 3.10及以上，标准库即可。输出到 `outputs/latest/`，附完整ZIP。命令先检查公开快照哈希，保留2026年10月23日核验日期；不会联网，不会发送，也不会伪造重新核验。

仅校验仓库：`python3 scripts/validate.py`。

## 从当前主数据重新排版

在Codex桌面环境中通过依赖工具获取Python、Node、包目录。重建还需要 `python-docx` 和 `lxml`。脚本优先使用显式环境变量，其次发现Codex缓存运行时，最后检查PATH。

```bash
python3 scripts/reproduce.py --rebuild
```

该模式先建立临时输出目录，复制已验收材料，读取 `data/` 中的客户/市场主表和报告，重新生成Word、客户Excel、一页打印Excel。源JSON与历史快照均不被覆盖。`@oai/artifact-tool` 不是公开仓库自带依赖；脚本不假装普通npm安装即可取得它。未发现正确运行时时明确报错，普通快照复现仍可用。

必要时设置：

```bash
FRIESGO_PYTHON=/path/to/python3 FRIESGO_NODE=/path/to/node FRIESGO_NODE_MODULES=/path/to/node_modules python3 scripts/reproduce.py --rebuild
```

只重建Word可用 `--rebuild-word`，需要python-docx/lxml但不需要Node。普通Python环境先 `python3 -m pip install -r requirements.txt`。

如果发现LibreOffice，重建打印Excel后会另导出PDF；可以通过 `FRIESGO_SOFFICE` 指定可执行文件。依赖不全时不把旧PDF当新PDF。重建文件的排版仍须重新视觉检查，原53页Word及1页PDF的验收结果不能自动转移给不同平台的重排版本。

首次需要无界面PDF排版且未指定 `FONTCONFIG_FILE` 时，会从Noto官方仓库固定提交下载两份CJK字体并校验SHA256，缓存于忽略的 `outputs/.fontcache/`；普通快照复现不下载字体。字体不作为仓库附件发布。

当前脚本是2026年10月23日案例构建器，含案例日期、国家分配与说明。新调研不是批量换名：按 `SKILL.md` 重新研究并同步报告、主数据、生成文字，再导出和验证。

## 验收要点

- 20个唯一账户，与名单、表格、Word、信件和来源的ID一致。
- 所有已选业务邮箱、电话、地址、事实、障碍和信件原文不丢失。
- 开发信20个独立商业问题；英文少于150词；本轮7份越南语、20份英文及20份中文。
- Word逐页渲染，检查中文、越南语、表格、来源链接、分页、孤行和空白页；不以文本提取代替视觉验收。
- 打印Excel的区域为A1:I25，A4横向、宽高均1页。导出PDF核实页面数1、尺寸约297×210mm、20家公司全在本页。渠道操作格必须为空。
- 复制/修改后检查文本与Office内部链接无私人路径或凭据。公开目录不放以后填写的实际客户跟进结果。

## 公共仓库与本地技能

仓库根目录就是一个技能入口，`SKILL.md` 采用标准技能结构，参考文件相对引用。用技能安装器将该仓库安装为 `friesgo-channel-prospecting`，或将本地检出目录链接到技能目录，即可用 `$friesgo-channel-prospecting` 调用。其他助手无需安装，也可从README的一句话及仓库链接开始。
