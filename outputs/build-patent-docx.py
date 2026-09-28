# 临时脚本：重建技术交底书 docx（复刻模板格式 + 嵌入 4 张专利附图）
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

BLUE = RGBColor(0x00, 0x00, 0xFF)
RED = RGBColor(0xFF, 0x00, 0x00)
GRAY = RGBColor(0x40, 0x40, 0x40)
FIG_DIR = "/Users/luzhaosheng/MyWork/专利申请模板+示例/附图"
OUT = "/Users/luzhaosheng/MyWork/专利申请模板+示例/技术交底书-一种基于规范驱动的人工智能辅助软件开发方法及系统.docx"

doc = Document()
# 页面 A4
sec = doc.sections[0]
sec.page_width, sec.page_height = Inches(8.27), Inches(11.69)
sec.left_margin = sec.right_margin = Inches(0.9)
sec.top_margin = sec.bottom_margin = Inches(0.9)


def style_run(r, size=14, bold=False, color=None, underline=False, east="宋体"):
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.underline = underline
    r.font.name = "Times New Roman"
    r._element.rPr.rFonts.set(qn("w:eastAsia"), east)
    if color:
        r.font.color.rgb = color


def para(text="", size=14, bold=False, color=None, underline=False,
         align=None, indent=None, space_after=6):
    p = doc.add_paragraph()
    if align:
        p.alignment = align
    if indent:
        p.paragraph_format.left_indent = Pt(indent)
    p.paragraph_format.space_after = Pt(space_after)
    if text:
        r = p.add_run(text)
        style_run(r, size, bold, color, underline)
    return p


def para_in(cell, text="", size=14, bold=False, color=None, underline=False,
            align=None, indent=None, space_after=6, first=False):
    p = cell.paragraphs[0] if first and not cell.paragraphs[0].text else cell.add_paragraph()
    if align:
        p.alignment = align
    if indent:
        p.paragraph_format.left_indent = Pt(indent)
    p.paragraph_format.space_after = Pt(space_after)
    if text:
        r = p.add_run(text)
        style_run(r, size, bold, color, underline)
    return p


def set_borders(table):
    tblPr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "4")
        el.set(qn("w:color"), "BFBFBF")
        borders.append(el)
    tblPr.append(borders)


def add_table(rows=1):
    t = doc.add_table(rows=rows, cols=1)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_borders(t)
    return t


# ===== 标题区 =====
para("技 术 交 底 书", size=22, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=20)

para("发明名称：", size=14, space_after=0).runs[0]
p = doc.paragraphs[-1]
r = p.add_run("  一种基于规范驱动的人工智能辅助软件开发方法及系统")
style_run(r, 14, underline=True)
p.paragraph_format.left_indent = Pt(28)

p = para("交底问题联系人：", size=14, space_after=0)
r = p.add_run("                鲁照生                         ")
style_run(r, 14, underline=True)
p.paragraph_format.left_indent = Pt(28)

p = para("交底问题联系人Tel：", size=14, space_after=0)
r = p.add_run("  13683558267___")
style_run(r, 14, underline=True)
r = p.add_run("E-mail：")
style_run(r, 14)
r = p.add_run("    luzhaosheng@bobfintech.com.cn             ")
style_run(r, 14, underline=True)
p.paragraph_format.left_indent = Pt(28)

# ===== 注意事项 =====
para("标注为“必填”的，为必填选项，其他选项可做也适当补充，如没有可直接提供辅助材料由我方代理人进行整理撰写。",
     size=16, color=RED, indent=21, space_after=6)
para("代理人并不是技术专家，交底书要使代理人能看懂，尤其是背景技术和详尽的技术方案，一定要写得全面、清楚。", bold=True)
para("全文对同一事物的叫法应统一，避免出现一种东西多种叫法。（这点最重要，否则可能使理解的方案有偏差）", bold=True)
para("和代理人沟通时，对于代理人的疑问应认真理解，要求补充的材料应及时补充。", bold=True)
para("专利法规定：", bold=True)
para("①专利必须是一个技术方案，应该阐述发明目的是通过什么技术方案来实现的，不能只有原理，也不能只做功能介绍；", bold=True)
para("交底书不能按功能写，应按步骤/层次写，即从步骤/层次角度扩展（以阶梯方式描述），使之逻辑清楚。若从功能角度写，则具有较多的介绍成分，使本发明的方法/系统分散，不易提炼本发明的核心。", bold=True, indent=28)
para("②专利必须充分公开，以本领域技术人员不需付出创造性劳动即可实现为准。", bold=True)

# ===== 一、背景技术 =====
para("一、详细介绍背景技术，并描述已有的与本发明最相近似的实现方案。", size=14, bold=True, color=BLUE, space_after=4)
t = add_table(rows=2)
c = t.rows[0].cells[0]
para_in(c, "1、背景技术（是指对发明的理解、检索、审查有用的技术，可以引证反映这些背景技术的文件）", size=10.5, first=True)
para_in(c, "2、最接近现有技术方案——它是作出实用技术新型技术方案的基础，引证文献、资料的，应写明其出处。", size=10.5)
c = t.rows[1].cells[0]
para_in(c, "1、技术背景：", bold=True, first=True)
para_in(c, "随着人工智能（AI）技术在软件工程领域的广泛应用，AI 辅助编程工具（如 GitHub Copilot、Cursor、Claude Code 等）已成为提升开发效率的重要手段。然而，现有的 AI 编程方案普遍存在以下问题：")
para_in(c, "（1）上下文遗忘：AI 在长会话中执行多个任务时，往往遗忘早期任务的架构约束和技术决策，导致代码风格不一致、架构漂移。")
para_in(c, "（2）需求追溯断裂：AI 生成的代码难以追溯到具体的需求来源，当需求变更时，无法准确评估影响范围，造成维护困难。")
para_in(c, "（3）Token 浪费：AI 花费大量计算资源在目录创建、文件读写等确定性操作上，而非专注于智能决策和代码生成。")
para_in(c, "（4）规范不一致：同一项目在不同 AI 会话中生成的代码风格、接口规范、错误处理方式各不相同，缺乏统一约束。")
para_in(c, "（5）质量不可控：AI 生成的代码缺乏系统性的验证机制，无法保证需求完整性、代码正确性和架构一致性。")
para_in(c, "现有的解决方案主要包括：TDD（测试驱动开发），先写测试再写代码，但测试用例本身需要人工编写，与 AI 的兼容性有限；BDD（行为驱动开发），通过场景描述驱动开发，但场景编写依赖人工，与 AI 的兼容性低；传统 Prompt 工程，通过精心设计的提示词引导 AI，但缺乏结构化约束和可追溯性。")
para_in(c, "2、现有技术方案：", bold=True)
para_in(c, "现有 AI 辅助编程工具的典型架构为“AI 直连代码”模式，即：")
para_in(c, "用户输入 → AI 模型 → 直接生成/修改代码", align=WD_ALIGN_PARAGRAPH.CENTER)
para_in(c, "该模式下，AI 同时承担“智能决策”和“文件操作”两种职责：智能决策，包括理解需求、设计架构、生成代码逻辑；文件操作，包括创建目录、读写文件、解析配置、执行命令。部分工具（如 Cursor、Windsurf）引入了简单的规则文件（如 .cursorrules），但规则文件仅作为文本提示注入，缺乏结构化解析、分层管理和动态激活机制。")

# ===== 二、现有技术的缺点 =====
para("二、现有技术的缺点是什么？针对这些缺点，说明本发明的目的。", size=14, bold=True, color=BLUE, space_after=4)
t = add_table(rows=1)
c = t.rows[0].cells[0]
para_in(c, "客观评价现有技术的缺点是针对于本发明的优点来说的，本发明不能解决的缺点不需要提供（缺点可以是成本高、误码率高、反应速度慢等类似问题）；例如发明了一个电脑，电脑不仅速度快，而且成本低，只要1块钱，那么我们可以认为现有的电脑有一下缺点：1、速度快的电脑价格贵；2、价格低的电脑速快慢。", size=10.5, first=True)
para_in(c, "可以从结构角度推导出现有相近产品的缺点。", size=10.5)
para_in(c, "1、AI 上下文窗口有限，长任务链中约束易丢失。", bold=True)
para_in(c, "现有方案依赖 AI 的上下文记忆来维持项目规范，当任务数量增多时，早期设定的架构约束、命名规范等容易被遗忘，导致代码风格漂移。")
para_in(c, "2、确定性操作消耗大量 AI Token。", bold=True)
para_in(c, "创建目录、读写配置文件、解析 YAML 等操作是确定性的，无需 AI 智能参与，但现有方案让 AI 直接执行这些操作，造成计算资源的浪费。")
para_in(c, "3、缺乏双向追溯机制。", bold=True)
para_in(c, "现有方案中，需求文档、任务定义、生成的代码之间没有建立关联关系，无法从代码反查需求，也无法从需求追踪实现状态。")
para_in(c, "4、规范约束非结构化。", bold=True)
para_in(c, ".cursorrules 等规则文件是纯文本，AI 可能忽略或误解其中的约束，缺乏强制性的结构化校验机制。")
para_in(c, "5、无质量门禁机制。", bold=True)
para_in(c, "AI 生成的代码缺乏自动化的质量检查流程，无法检测是否符合规范、是否满足需求、是否引入安全风险。")
para_in(c, "6、多端项目缺乏统一管理。", bold=True)
para_in(c, "在前后端分离、多端并行的项目中，现有方案无法统一管理各端的规范、接口契约和依赖关系。")
para_in(c, "针对上述缺点，本发明的目的在于提供一种基于规范驱动的人工智能辅助软件开发方法及系统，实现智能逻辑与确定性逻辑的解耦，建立结构化的规范数据库，构建需求-任务-代码双向追溯链，并提供质量门禁与变更感知机制，从而提高 AI 辅助软件开发的一致性、可追溯性与质量可控性。")

# ===== 三、技术问题 =====
para("三、本发明需要解决的技术问题是：", size=14, bold=True, color=BLUE, space_after=4)
t = add_table(rows=1)
c = t.rows[0].cells[0]
p = para_in(c, "要解决的技术问题：是指要解决的现有技术中存在的技术问题，应当针对现有技术存在的缺陷或不足，用简明、准确的语言写明发明所要解决的技术问题，也可以进一步说明其技术效果，但是不得采用广告式宣传用语，", size=10.5, first=True)
r = p.add_run("此处的所解决的技术问题与第二部分的技术缺点是相对应的。")
style_run(r, 10.5, color=RED)
para_in(c, "针对第二部分所述的现有技术缺陷，本发明需要解决以下技术问题：", indent=28)
problems = [
    "（1）智能逻辑与确定性逻辑的解耦问题：将 AI 的智能决策能力与确定性的工程操作分离，让 AI 专注于需求理解与代码生成，由命令行工具负责执行目录创建、文件读写等确定性操作，以降低 Token 消耗、提升执行可靠性；",
    "（2）项目规范的结构化存储与动态激活问题：设计分层的规范存储结构（AGENTS/RULES/COMMANDS/SKILLS/HOOKS），使项目规范可被 AI 精确读取、按技术栈动态激活并强制校验；",
    "（3）需求-任务-代码的关联追溯问题：建立从需求文档（REQ）到开发任务（Task）再到源代码（Code）的完整关联链路，支持变更影响分析和状态同步；",
    "（4）项目全局与单次迭代的分层分析问题：针对项目全局和单个迭代分别建立分析模型，全局分析产出跨迭代复用的技术资产，迭代分析产出可执行的实施规格；",
    "（5）代码质量的自动化把关问题：在代码生成的前、中、后阶段自动进行合规校验、质量评分，并通过代码变更检测自动标记受影响的规范文档；",
    "（6）跨实体类型的知识检索问题：将需求、规格、任务等知识实体与类、方法、接口等代码实体统一建模，融合本地匹配与语义匹配，支持自然语言查询和语义关联。",
]
for x in problems:
    para_in(c, x, indent=28)

# ===== 四、技术方案 =====
para("四、本发明技术方案的详细阐述：", size=14, bold=True, color=BLUE, space_after=4)
t = add_table(rows=2)
c = t.rows[0].cells[0]
p = para_in(c, "本部分为专利申请最重要的部分，需要详细提供", size=10.5, bold=True, indent=21, first=True)
p = para_in(c, "发明中每一功能的实现都要有相应的", size=10.5, indent=21)
r = p.add_run("技术方案")
style_run(r, 10.5, bold=True, color=RED)
r = p.add_run("；（专利必须是一个技术方案，应该阐述发明目的通过什么技术方案来实现的，不能只有原理，也不能只做功能介绍）")
style_run(r, 10.5)
para_in(c, "提供结构图及文字说明（工艺步骤、结构说明，原理说明，动作关系说明等）；", size=10.5, indent=21)
para_in(c, "所有附图都应该有详细的文字描述，以别人不看附图即可明白技术方案为准；", size=10.5, indent=21)
para_in(c, "同时附图中的关键词或方框图中的用中文。", size=10.5, indent=21)

c = t.rows[1].cells[0]
para_in(c, "涉及计算机程序的发明，需要说明各程序模块先后运行、相互配合以解决技术问题的具体方式。本发明提出一种“规范驱动开发（Spec-Driven Development，SDD）”方法及系统：由智能决策层（AI 层）负责需求理解与代码生成，确定性执行层（CLI 层）负责全部工程操作，结构化知识层（规范数据库层）为智能决策提供规范支撑，三层分工协作，以规范贯穿需求、任务与代码。以下从系统构成、方法流程、各组成模块的具体实现与关键流程示例四个方面进行阐述，并给出附图说明。", indent=28, first=True)

para_in(c, "4.1 系统整体构成", bold=True)
para_in(c, "本发明提供一种基于规范驱动的人工智能辅助软件开发系统，其特征在于，所述系统包括：", indent=28)
modules = [
    ("意图识别模块", "，用于接收用户的自然语言开发指令，识别开发意图，并将其映射为对应的工程操作命令；"),
    ("确定性执行模块（CLI 命令行接口）", "，用于接收所述工程操作命令，执行目录创建、文件读写、配置解析、格式校验等确定性工程操作，并对全部写操作实施事务保护，操作失败时自动回滚；"),
    ("规范数据库模块", "，用于以五层结构存储项目规范，所述五层结构包括 AGENTS 角色定义层、RULES 编码规范层、COMMANDS 命令模板层、SKILLS 可复用技能层及 HOOKS 生命周期钩子层，并向智能决策层提供结构化知识输入；"),
    ("分层分析模块", "，用于对项目全局执行分层递进的全局分析，产出跨迭代复用的技术资产；并用于对当前迭代的需求执行迭代分析，产出可执行的实施规格；"),
    ("任务拆分模块", "，用于将功能单元按端（如后端、前端、移动端等）拆分为若干开发任务，并为每个开发任务生成任务元信息、核心规格及各端的实施骨架；"),
    ("代码生成与写入模块", "，用于由智能决策层读取开发任务的规格生成代码内容，并在质量门禁校验通过后，由确定性执行模块将代码写入该开发任务关联的源码路径；"),
    ("双向追溯模块", "，用于建立并维护“需求-任务-代码”的关联记录，支持按需求查询影响范围、按任务查询上下文，以及需求到代码的全链路追踪；"),
    ("质量门禁模块", "，用于在代码生成前、生成中、生成后依次执行合规校验、编译测试与安全审计，校验不通过时阻断流程并生成问题清单；"),
    ("图谱融合查询模块", "，用于对需求、规格、任务等知识实体与类、方法、接口等代码实体统一建模，支持自然语言查询，并融合本地匹配与语义匹配的结果输出检索结论。"),
]
for name, desc in modules:
    p = para_in(c, indent=28)
    r = p.add_run(name)
    style_run(r, 14, bold=True)
    r = p.add_run(desc)
    style_run(r, 14)

para_in(c, "4.2 方法流程", bold=True)
para_in(c, "本发明还提供一种基于规范驱动的人工智能辅助软件开发方法，其特征在于，包含以下步骤：", indent=28)
steps = [
    ("步骤 S1、初始化", "：创建规范数据库目录结构，生成记录技术栈与命名规范的技术宪法文件，以及记录端列表与源码路径的项目配置文件；"),
    ("步骤 S2、需求导入", "：将原始需求文档转换为结构化需求规格，存入迭代目录的需求层；"),
    ("步骤 S3、需求切分", "：将需求文档切分为若干功能单元，每个功能单元对应需求原文切片及其元信息；"),
    ("步骤 S4、分层分析", "：读取规范数据库中的技术宪法与编码规范，对所述功能单元执行迭代分析，产出单元概述与各端的技术规格、测试规格；对项目全局执行分层递进的全局分析，产出端索引、跨端关联、全局架构及各端技术文档；"),
    ("步骤 S5、任务拆分", "：将所述功能单元按端拆分为若干开发任务，生成任务元信息、任务级核心规格与各端实施骨架，并建立需求与任务的关联关系；"),
    ("步骤 S6、代码生成与写入", "：智能决策层读取所述开发任务的规格生成代码，经质量门禁校验通过后，由确定性执行模块写入技术宪法与项目配置所声明的源码路径；"),
    ("步骤 S7、验证归档", "：执行编译检查、Lint 检查、单元测试与界面验证，全部通过后归档任务并更新全局索引；"),
    ("步骤 S8、追溯更新", "：同步更新“需求-任务-代码”的关联记录，重建知识图谱与代码图谱索引，供变更影响分析与自然语言检索使用。"),
]
for name, desc in steps:
    p = para_in(c, indent=28)
    r = p.add_run(name)
    style_run(r, 14, bold=True)
    r = p.add_run(desc)
    style_run(r, 14)

para_in(c, "4.3 各组成模块的详细技术实现", bold=True)
detail = [
    ("4.3.1 三层解耦总体架构", [
        "本发明核心架构为三层解耦模型：",
        "第一层：智能决策层（AI 层），负责理解用户意图、决定执行哪些操作、生成代码内容，并读取规范数据库指导决策；",
        "第二层：确定性执行层（CLI 层），负责创建目录结构、读写配置和规格文件、解析 YAML/JSON 配置、执行合规校验，并对所有写操作提供事务保护（失败自动回滚）；",
        "第三层：结构化知识层（规范数据库层），负责存储 AGENTS（角色定义）、RULES（编码规范）、COMMANDS（命令模板）、SKILLS（可复用技能）、HOOKS（生命周期钩子）五类规范。",
        "三层之间通过标准化接口交互：智能决策层输出决策指令，确定性执行层接收指令并执行确定性操作，结构化知识层为智能决策层提供结构化知识输入。该架构将原本由 AI 承担的确定性工程操作剥离至 CLI 层，使 AI 的上下文窗口与 Token 预算集中于需求理解和代码生成。",
    ]),
    ("4.3.2 规范数据库五层结构", [
        "第一层：AGENTS（专业角色定义层）。定义各命令/阶段下激活的专业 AI 角色，采用“注册表 + 自描述”双轨合并机制：每个角色是一个包含激活规则（activations frontmatter）的 Markdown 文件，注册表统一登记。支持特化版本解析回退链（如 product-analyst → product-analyst-backend → product-analyst-finance），并支持条件过滤表达式（如 project.securityLevel > 2、project.industry == 'finance'），实现按项目属性动态激活相应角色。",
        "第二层：RULES（编码规范层）。按语言/框架分层的编码规范，在执行阶段按技术栈自动注入提示词。技术栈匹配：从技术宪法文件解析 language、framework、database 字段，匹配对应规范文件；优先级排序：高优先级规范先注入（如 security=100 > typescript=100 > react=90）；用户自定义覆盖：同名文件覆盖内置默认。",
        "第三层：COMMANDS（命令模板层）。预定义的命令执行模板，如 PR 审查、变更影响分析、代码生成等。",
        "第四层：SKILLS（可复用技能层）。封装可复用的开发技能，如部署、数据库迁移、缓存配置等。",
        "第五层：HOOKS（生命周期钩子层）。在命令执行的关键节点插入自定义逻辑，如 pre-execute、post-execute。",
        "进一步地，规范数据库通过四层覆盖机制保证规范对 AI 的可见性：第一层目录索引（扫描全部规范文件生成带摘要的目录）；第二层自动注入（将关键规范全文按优先级注入 AI 上下文，并设置注入总量上限）；第三层语义检索（对全部规范建立索引，支持按语义召回）；第四层阅读清单（在上下文中提示何种场景应读取何类规范）。",
    ]),
    ("4.3.3 全局分析与迭代分析分层机制", [
        "全局分析（Global Analysis）按四层递进执行，产出跨迭代复用的全局技术资产：",
        "Layer 1（端索引）：扫描项目结构，生成各端的功能模块索引；",
        "Layer 2（跨端关联）：分析端间依赖关系，生成功能模块清单和关联映射；",
        "Layer 3（模块深入）：对每个功能模块进行技术深度分析；",
        "Layer 4（综合文档），细分为：4a 产品视角需求文档（REQUIREMENT.md）；4b 技术核心文档（ARCHITECTURE.md、API_CONTRACT.yaml）；4c 技术扩展文档（SECURITY_AUDIT.md、PERFORMANCE_BASELINE.md）；4d 各端技术文档（API_INVENTORY.md、DATA_MODEL.md、UI_FLOW.md）。",
        "迭代分析（Iteration Analysis）针对当前迭代的需求文档，产出可执行的实施规格：",
        "Phase 1：生成迭代级全局规格（REQUIREMENT.md、ANALYSIS.md、TECH.md、DEV_GUIDE.md）；",
        "Phase 2：按功能模块和各端生成专属规格（TECH.md、TEST.md、UI_SPEC.md）。",
        "两层分析通过规范数据库关联：全局分析的产出沉淀为跨迭代复用的技术资产，迭代分析的产出则直接驱动任务拆分与代码生成。",
    ]),
    ("4.3.4 双向追溯机制", [
        "建立“需求（REQ）→ 开发任务（Task）→ 源代码（Code）”的完整关联链路：",
        "需求层：需求文档（REQ.md）定义功能需求，分配唯一标识符；",
        "任务层：通过任务拆分命令（taskify）将功能单元拆分为开发任务（Task-NNN），每个任务包含 .meta/ 元信息、00-specs/ 核心规格及各端实现目录；",
        "代码层：代码写入技术宪法文件与项目配置文件所声明的源码路径，通过文件路径和注释与任务关联。",
        "基于该关联链路，支持如下操作：影响分析，按需求标识查询其影响范围（如 speccore impact）；上下文查询，查看指定任务的上下文和依赖（如 speccore context）；全链路追踪，REQ→Task→Code 全链路追踪（speccore track）。",
    ]),
    ("4.3.5 质量门禁与变更感知", [
        "质量门禁按代码生成的三个阶段设置：",
        "前置检查：代码新鲜度检查、规格完整性校验、依赖一致性检查；",
        "执行检查：编译检查、Lint 检查、单元测试、API 契约测试；",
        "后置检查：界面验证、性能基线测试、安全审计。",
        "进一步地，三道质量门禁分别由专职角色依次把关：编译者角色（负责编译与测试）、安全审查者角色（负责安全与性能）、文档同步者角色（负责规格与代码一致性），任一环节不通过即阻断流程并生成问题清单（.issues.md）。",
        "变更感知机制：通过版本差异比对（Git diff）检测代码变更；自动分析变更影响范围，标记受影响的规范文档；生成问题追踪清单，记录发现的问题和修复状态。",
    ]),
    ("4.3.6 知识图谱与代码图谱融合", [
        "知识图谱：存储需求、规格、任务、功能模块等实体及其关系；",
        "代码图谱：通过编译器 API 本地解析源码，提取类、方法、接口、路由等代码实体。",
        "融合查询机制：",
        "统一查询入口：以自然语言发起查询（如 speccore graph “订单相关代码”）；",
        "语义标签匹配：查询“订单”亦能匹配到 booking、purchase、交易等相关代码；",
        "综合得分计算：综合得分 = 本地匹配得分 × 0.4 + 语义匹配得分 × 0.6；",
        "结果融合：同时检索知识图谱（需求/任务）和代码图谱（类/方法），按综合得分排序输出。",
    ]),
    ("4.3.7 事务保护机制", [
        "所有写操作具备事务保护：写入前备份原始内容（.bak），写入失败时自动回滚；提供回滚命令（speccore rollback）从备份恢复规格文件；删除操作采用软删除（移入回收站）并同步清理关联引用，确保规范数据库和源码的一致性。",
    ]),
]
for title, paras in detail:
    p = para_in(c, title, indent=28)
    r = p.runs[0]
    style_run(r, 14, bold=True)
    for x in paras:
        para_in(c, x, indent=28)

para_in(c, "4.4 关键流程示例", bold=True)
para_in(c, "以 AI 辅助开发一个用户登录功能为例，说明各模块的协作过程：", indent=28)
flow = [
    "步骤 1：用户通过 AI IDE 输入自然语言指令：@spec-ask “我想做登录功能”；",
    "步骤 2：智能决策层理解意图，生成工程操作指令：speccore analyze -I 当前迭代 --prompt “用户登录需求分析”；",
    "步骤 3：确定性执行层读取规范数据库（技术宪法中的技术栈、RULES 中的编码规范），创建分析所需的目录结构；",
    "步骤 4：智能决策层生成分析文档（REQ.md、TECH.md），确定性执行层将其写入 Iteration-NNN/020-specs/用户认证/；",
    "步骤 5：用户确认后，智能决策层生成任务拆分指令：speccore taskify -I 当前迭代；",
    "步骤 6：确定性执行层自动拆分任务，创建 Task-001-用户认证/ 目录及子任务结构；",
    "步骤 7：智能决策层读取任务规格生成代码，经质量门禁校验后，确定性执行层将代码写入源码路径；",
    "步骤 8：执行 speccore verify 进行编译检查、Lint、单元测试与界面验证；",
    "步骤 9：执行 speccore done 归档任务，更新全局索引与知识图谱、代码图谱。",
]
for x in flow:
    para_in(c, x, indent=28)

para_in(c, "4.5 附图说明", bold=True)
figs = [
    ("图 1", "为系统总体架构图，自上而下示出三层：智能决策层（AI 层）、确定性执行层（CLI 层）、结构化知识层（规范数据库层）；层间以箭头示出交互关系——智能决策层向确定性执行层下发决策指令，确定性执行层向上反馈执行结果，结构化知识层向智能决策层注入规范知识。", "fig1.png", 4.6, "图 1  系统总体架构图"),
    ("图 2", "为软件开发方法主流程图，示出步骤 S1 初始化 → S2 需求导入 → S3 需求切分 → S4 分层分析 → S5 任务拆分 → S6 代码生成与写入 → S7 验证归档 → S8 追溯更新的执行顺序；其中 S6 处设置质量门禁判断分支，校验不通过则返回修改后重新校验。", "fig2.png", 3.0, "图 2  软件开发方法主流程图"),
    ("图 3", "为双向追溯链路示意图，示出需求文档（REQ）指向开发任务（Task）再指向源代码（Code）的正向链路，以及由代码反查任务、由任务反查需求的反向链路，并示出变更感知旁路：代码变更时自动标记受影响的规范文档。", "fig3.png", 4.6, "图 3  双向追溯链路示意图"),
    ("图 4", "为规范数据库五层结构图，自上而下示出 AGENTS、RULES、COMMANDS、SKILLS、HOOKS 五层，及各层向智能决策层提供结构化输入的通道。", "fig4.png", 3.9, "图 4  规范数据库五层结构图"),
]
for label, desc, png, width_in, caption in figs:
    p = para_in(c, indent=28)
    r = p.add_run(label)
    style_run(r, 14, bold=True)
    r = p.add_run(" " + desc)
    style_run(r, 14)
    # 图片段落
    pic_p = c.add_paragraph()
    pic_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    pic_p.paragraph_format.space_before = Pt(8)
    pic_p.paragraph_format.space_after = Pt(4)
    run = pic_p.add_run()
    run.add_picture(f"{FIG_DIR}/{png}", width=Inches(width_in))
    # 图注
    cap_p = c.add_paragraph()
    cap_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap_p.paragraph_format.space_after = Pt(12)
    r = cap_p.add_run(caption)
    style_run(r, 12)

# ===== 五、保护点 =====
para("五、本发明的关键点和欲保护点是：", size=14, bold=True, color=BLUE, space_after=4)
t = add_table(rows=1)
c = t.rows[0].cells[0]
para_in(c, "发明内容部分提供的是为完成一定功能的完整的技术方案，在本部分是提炼出技术方案的关键创新点，列出1、2、3……以提醒代理人注意，便于专利代理人撰写权利要求书。", size=10.5, indent=21, first=True)
para_in(c, "注意：简单点明即可；具体可以是根据第六部分能给本发明带来有益效果的关键技术点。", size=10.5, indent=21)
points = [
    "（1）智能逻辑与确定性逻辑的解耦架构：智能决策层负责智能决策，确定性执行层负责确定性执行，结构化知识层提供规范知识支撑，三层通过标准化接口交互，使 AI 专注决策、工程操作确定执行。",
    "（2）五层规范数据库结构：AGENTS/RULES/COMMANDS/SKILLS/HOOKS 的分层设计，支持角色定义、编码规范、命令模板、可复用技能和生命周期钩子的结构化存储、动态激活与强制校验。",
    "（3）全局分析与迭代分析的分层机制：全局分析按 Layer 1→2→3→4 四层递进产出跨迭代复用资产，迭代分析按 Phase 1→2 产出可执行规格，两层分析通过规范数据库关联。",
    "（4）需求-任务-代码双向追溯链：从需求文档到开发任务再到源代码的完整关联链路，支持变更影响分析、状态同步和全链路追踪。",
    "（5）质量门禁与变更感知的自动化机制：代码生成前/中/后三层质量检查与专职角色把关，结合版本差异检测的变更感知和受影响文档自动标记。",
    "（6）知识图谱与代码图谱的融合查询：基于语义标签的跨实体类型匹配，融合本地匹配与语义匹配的检索结果综合排序。",
    "（7）事务保护机制：所有写操作具备事务保护，失败时自动回滚，确保规范数据库和源码的一致性。",
]
for x in points:
    para_in(c, x)

doc.save(OUT)
print("已生成:", OUT)
