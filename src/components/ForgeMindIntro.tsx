import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { animate, stagger } from 'animejs'
import {
  Activity as ActivityData,
  ArrowDown as ArrowDownData,
  ArrowRight as ArrowRightData,
  ArrowUpRight as ArrowUpRightData,
  BookOpen as BookOpenData,
  Boxes as BoxesData,
  CircuitBoard as CircuitBoardData,
  Cloud as CloudData,
  Download as DownloadData,
  Gauge as GaugeData,
  Factory as FactoryData,
  FileText as FileTextData,
  Layers3 as Layers3Data,
  Mail as MailData,
  MapPin as MapPinData,
  Menu as MenuData,
  Orbit as OrbitData,
  Route as RouteData,
  ShieldCheck as ShieldCheckData,
  Sparkles as SparklesData,
  Workflow as WorkflowData,
  X as XData,
} from 'lucide'
import type { MorphIconProps } from 'morphicons/react'
import { EmotionBallHero } from './EmotionBallHero'
import { ForgeLabPage, ForgeLabPostPage } from './ForgeLabPage'
import { ForgePassPage } from './ForgePassPage'
import '../forgelab.css'
import { MorphingIcon } from './MorphingIcon'
import { useAuthStore } from '../store/auth'
import { BACKEND_BASE } from '../api/backendBase'
import userGuideMarkdown from '../../docs/ForgeMind-用户使用手册.md?raw'
import technicalMarkdown from '../../docs/ForgeMind-功能模块技术文档.md?raw'
import forgeMindModuleMarkdown from '../../docs/ForgeMind-模块用户文档.md?raw'
import forgeCloudUserMarkdown from '../../docs/ForgeCloud-用户文档.md?raw'
import forgeHubUserMarkdown from '../../docs/ForgeHub-用户文档.md?raw'
import forgeLabUserMarkdown from '../../docs/ForgeLab-用户文档.md?raw'
import forgeMoveUserMarkdown from '../../docs/ForgeMove-用户文档.md?raw'
import forgePassUserMarkdown from '../../docs/ForgePass-用户文档.md?raw'
import forgeEcosystemTechnicalMarkdown from '../../docs/Forge生态-模块技术文档.md?raw'

type ForgeMindIntroProps = {
  onEnterWorkspace: () => void
  onOpenForgeCloud: () => void
}

type PortalMorphIconProps = Omit<MorphIconProps, 'icon'> & {
  icon: MorphIconProps['icon']
  activeIcon?: MorphIconProps['icon']
}

function PortalMorphIcon({ icon, activeIcon, ...props }: PortalMorphIconProps) {
  const [active, setActive] = useState(false)

  return <MorphingIcon
    {...props}
    className={`fmi-morph-icon${props.className ? ` ${props.className}` : ''}`}
    icon={active && activeIcon ? activeIcon : icon}
    onPointerEnter={() => activeIcon && setActive(true)}
    onPointerLeave={() => activeIcon && setActive(false)}
  />
}

type DocumentId = 'user' | 'technical' | 'forgemind' | 'forgecloud' | 'forgehub' | 'forgelab' | 'forgemove' | 'forgepass' | 'ecosystem-technical'
type DocumentPage = `docs-${DocumentId}`
type PortalPage = 'home' | 'product' | 'docs' | 'forgehub' | 'forgecloud' | 'forgelab' | 'forgelab-post' | DocumentPage

const navItems: Array<{ id: Exclude<PortalPage, 'home' | 'forgelab-post'>; label: string; icon: typeof FactoryData }> = [
  { id: 'product', label: '产品介绍', icon: FactoryData },
  { id: 'docs', label: '官方文档', icon: BookOpenData },
  { id: 'forgehub', label: 'ForgeHub', icon: BoxesData },
  { id: 'forgecloud', label: 'ForgeCloud', icon: CloudData },
  { id: 'forgelab', label: 'ForgeLab', icon: OrbitData },
]

const docs = [
  {
    id: 'user' as DocumentId,
    eyebrow: 'USER / GUIDE',
    title: 'ForgeMind 用户使用文档',
    body: '从登录、新建工厂到生产仿真、仓储物流和诊断工作区。',
    href: '/docs/user',
    icon: FileTextData,
  },
  {
    id: 'technical' as DocumentId,
    eyebrow: 'TECH / REFERENCE',
    title: '功能模块技术说明',
    body: '了解前端仿真、三维场景、资源导入、存档和 Agent 接入边界。',
    href: '/docs/technical',
    icon: CircuitBoardData,
  },
  {
    id: 'forgemind' as DocumentId,
    eyebrow: 'MODULE / FORGEMIND',
    title: 'ForgeMind 模块用户文档',
    body: '工作台、建造、生产、仓储、仿真与诊断的操作指南。',
    href: '/docs/forgemind',
    icon: FactoryData,
  },
  {
    id: 'forgecloud' as DocumentId,
    eyebrow: 'MODULE / FORGECLOUD',
    title: 'ForgeCloud 用户文档',
    body: '工作空间、项目版本、资源、发布、协作与云端事实。',
    href: '/docs/forgecloud',
    icon: CloudData,
  },
  {
    id: 'forgehub' as DocumentId,
    eyebrow: 'MODULE / FORGEHUB',
    title: 'ForgeHub 用户文档',
    body: '工业资源库、参数化 CAD、STEP、装配与资源包交换。',
    href: '/docs/forgehub',
    icon: BoxesData,
  },
  {
    id: 'forgelab' as DocumentId,
    eyebrow: 'MODULE / FORGELAB',
    title: 'ForgeLab 用户文档',
    body: '社区浏览、发帖、附件、回复、点赞与通知。',
    href: '/docs/forgelab',
    icon: OrbitData,
  },
  {
    id: 'forgemove' as DocumentId,
    eyebrow: 'MODULE / FORGEMOVE',
    title: 'ForgeMove 用户文档',
    body: '微信小程序的移动摘要、任务、库存、监控与离线边界。',
    href: '/docs/forgemove',
    icon: ActivityData,
  },
  {
    id: 'forgepass' as DocumentId,
    eyebrow: 'MODULE / FORGEPASS',
    title: 'ForgePass 用户文档',
    body: '统一账户注册、登录、退出与跨 Forge 产品身份边界。',
    href: '/docs/forgepass',
    icon: ShieldCheckData,
  },
  {
    id: 'ecosystem-technical' as DocumentId,
    eyebrow: 'TECH / ECOSYSTEM',
    title: 'Forge 生态模块技术文档',
    body: '六个 Forge 模块的架构边界、接口、数据流和验证入口。',
    href: '/docs/ecosystem-technical',
    icon: CircuitBoardData,
  },
]

const productPillars = [
  { eyebrow: 'SPACE / BUILD', title: '搭建生产空间', body: '用统一网格放置设备、传送带、仓储与楼层，让空间关系先被看见。', icon: Layers3Data },
  { eyebrow: 'FLOW / DEFINE', title: '定义物料与工艺', body: '从物品、配方和端口开始，把工艺链变成可运行的生产规则。', icon: RouteData },
  { eyebrow: 'RUN / OBSERVE', title: '运行真实物料流', body: '观察节拍、库存、背压、车辆和设备状态，让问题在数字世界里暴露。', icon: ActivityData },
  { eyebrow: 'SIGNAL / IMPROVE', title: '诊断下一步动作', body: '用确定性诊断和可审批的 Agent 方案，把异常变成可以执行的改进。', icon: ShieldCheckData },
]

const productModules = [
  { eyebrow: 'IDENTITY / PROJECT', title: '登录与工厂项目', body: '账号登录后管理自己的工厂项目、楼层、对象和导入资源；本地模式也可独立运行核心编辑与仿真。', detail: '用户隔离 · 多项目 · 云端存档', icon: ShieldCheckData },
  { eyebrow: 'SPACE / EDITOR', title: '三维工厂编辑器', body: '在统一网格中放置、旋转、移动和删除设备，支持多楼层、占地计算、边界检查、碰撞校验和框选。', detail: 'L1 / L2 / L3 · 1M GRID · COLLISION', icon: Layers3Data },
  { eyebrow: 'CATALOG / RECIPE', title: '物品、配方与生产路线', body: '创建物品和配方，配置输入输出端口、工艺链和生产节拍，让加工关系从目录进入场景。', detail: 'ITEMS · RECIPES · PORTS · ROUTES', icon: BoxesData },
  { eyebrow: 'MACHINE / MODEL', title: '机械制造与模型库', body: '管理机器定义，选择内置工业模型或用户导入模型，并将真实模型路径、参数和预览统一到机器实例。', detail: 'CNC · WORKSTATION · INSPECTION · CUSTOM', icon: FactoryData },
  { eyebrow: 'LOGISTICS / CONVEYOR', title: '传送带与端口物流', body: '拖绘直线、弯道和跨层倾斜传送带，自动处理转点、端口吸附、方向、避障和在途物料。', detail: 'PORT CONNECTION · BACKPRESSURE · MULTIFLOOR', icon: RouteData },
  { eyebrow: 'WAREHOUSE / INVENTORY', title: '仓储与真实库存', body: '使用有限容量货架、入货仓库、出货仓库和存取站，查看物料台账、库存变化、消耗与交付。', detail: 'RACKS · INBOUND · OUTBOUND · STOCK LEDGER', icon: BoxesData },
  { eyebrow: 'FLEET / AGV', title: 'AGV 运输编程', body: '为 AGV 设置起点、终点、物品、每趟数量、优先级和库存触发条件，运行八方向确定性寻路与重规划。', detail: '8-WAY A* · TASKS · YIELDING · REPLAN', icon: RouteData },
  { eyebrow: 'FLEET / DRONE', title: '无人机跨层运输', body: '为无人机配置任意楼层的仓储任务，通过三维路径在不同楼层间取放货物，遵守真实库存与容量。', detail: '26-NEIGHBOR 3D A* · CROSS-FLOOR', icon: ActivityData },
  { eyebrow: 'SIMULATION / SIGNAL', title: '确定性生产仿真', body: '固定步长推进机器、传送带、物料、AGV 和无人机，实时观察加工、阻塞、在途、产出与设备状态。', detail: 'REPLAYABLE · FIXED SEED · ITEM LOTS', icon: ActivityData },
  { eyebrow: 'VISION / INSPECTION', title: '视觉检测工作台', body: '将视觉检测设备、相机和检测流程接入工厂场景，保留真实设备状态与检测工作区入口。', detail: 'VISION CELL · CAMERA · RESULT STATE', icon: CircuitBoardData },
  { eyebrow: 'AGENT / DIAGNOSIS', title: 'ForgeCore Agent 诊断', body: '通过只读工具、运行证据、Finding、Patch、审批、应用和回滚，定位结构与生产问题并控制修改边界。', detail: '12 TOOLS · PATCH · APPROVAL · ROLLBACK', icon: ShieldCheckData },
  { eyebrow: 'PATROL / AUTOPILOT', title: '自动巡检与趋势预警', body: '固定窗口运行只读证据副本，跟踪吞吐、利用率、阻塞和在途趋势，生成中文报告与瓶颈因果链。', detail: '60S EVIDENCE · TREND · ETA · NARRATIVE', icon: GaugeData },
  { eyebrow: 'GENERATIVE / DAIYU', title: '生成式工厂规划', body: '输入目标后生成候选布局，完成设备估算、端口路由、碰撞校验、副本仿真、What-if 对比和人工应用。', detail: 'CANDIDATES · WHAT-IF · WORKER · APPLY', icon: SparklesData },
  { eyebrow: 'RESOURCE / IMPORT', title: '资源包导入与模型预览', body: '拖放或选择 JSON/GLB 资源，进行结构校验、包围盒归一化、模型预览、封面生成和用户级持久化。', detail: 'JSON · GLB · PREVIEW · PRIVATE RESOURCE', icon: FileTextData },
  { eyebrow: 'ASSISTANT / OPTIONAL AI', title: 'AI 管家与语音能力', body: '可选接入规则服务、远程 AI、ASR 和 TTS；关闭 AI 时，建造、仿真、寻路和诊断仍由本地规则运行。', detail: 'RULE FIRST · REMOTE OPTIONAL · VOICE OPTIONAL', icon: BookOpenData },
  { eyebrow: 'COMMUNITY / FORGELAB', title: '开放工厂社区', body: '在 ForgeLab 阅读和发布工厂存档、模型资源、布局经验与设计公告，让验证过程可以被下一位设计者继续。', detail: 'POSTS · ATTACHMENTS · REPLIES · NOTIFICATIONS', icon: OrbitData },
]

function pageFromPath(pathname: string): PortalPage {
  if (pathname === '/product') return 'product'
  if (pathname === '/docs') return 'docs'
  if (pathname === '/docs/user') return 'docs-user'
  if (pathname === '/docs/technical') return 'docs-technical'
  const document = docs.find((item) => item.href === pathname)
  if (document) return `docs-${document.id}` as DocumentPage
  if (pathname === '/forgehub') return 'forgehub'
  if (pathname === '/forgelab/login') return 'forgelab'
  if (/^\/forgelab\/post\/[^/]+$/.test(pathname)) return 'forgelab-post'
  if (pathname === '/forgelab') return 'forgelab'
  return 'home'
}

function postIdFromPath(pathname: string) {
  const match = pathname.match(/^\/forgelab\/post\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : ''
}

function slugifyHeading(value: string) {
  return value.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
}

function inlineMarkdown(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link) return <a key={index} href={link[2]}>{link[1]}</a>
    return <span key={index}>{part}</span>
  })
}

function markdownBlocks(markdown: string): ReactNode[] {
  const lines = markdown.replace(/\r/g, '').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index].trimEnd()
    if (!line.trim()) { index += 1; continue }
    if (line.startsWith('```')) {
      const language = line.slice(3).trim()
      const code: string[] = []
      index += 1
      while (index < lines.length && !lines[index].startsWith('```')) { code.push(lines[index]); index += 1 }
      index += 1
      blocks.push(<pre className="fmi-doc-code" key={`code-${index}`}><code data-language={language}>{code.join('\n')}</code></pre>)
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6)
      const text = heading[2].replace(/\s+#$/, '')
      const id = slugifyHeading(text)
      const headingKey = `heading-${index}`
      const headingNode = level === 2 ? <h2 id={id} key={headingKey}>{inlineMarkdown(text)}</h2>
        : level === 3 ? <h3 id={id} key={headingKey}>{inlineMarkdown(text)}</h3>
          : <h4 id={id} key={headingKey}>{inlineMarkdown(text)}</h4>
      blocks.push(headingNode)
      index += 1
      continue
    }
    if (line === '---') { blocks.push(<hr key={`rule-${index}`} />); index += 1; continue }
    if (line.startsWith('>')) {
      const quote: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('>')) { quote.push(lines[index].trim().replace(/^>\s?/, '')); index += 1 }
      blocks.push(<blockquote key={`quote-${index}`}>{quote.map((item, quoteIndex) => <p key={quoteIndex}>{inlineMarkdown(item)}</p>)}</blockquote>)
      continue
    }
    if (line.startsWith('|')) {
      const rows: string[][] = []
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        const cells = lines[index].trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
        if (!cells.every((cell) => /^:?-{2,}:?$/.test(cell))) rows.push(cells)
        index += 1
      }
      if (rows.length) blocks.push(<table key={`table-${index}`}><thead><tr>{rows[0].map((cell, cellIndex) => <th key={cellIndex}>{inlineMarkdown(cell)}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inlineMarkdown(cell)}</td>)}</tr>)}</tbody></table>)
      continue
    }
    const ordered = /^\d+\.\s+/.test(line)
    const unordered = /^[-*]\s+/.test(line)
    if (ordered || unordered) {
      const items: string[] = []
      while (index < lines.length && (ordered ? /^\d+\.\s+/.test(lines[index].trim()) : /^[-*]\s+/.test(lines[index].trim()))) {
        items.push(lines[index].trim().replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ''))
        index += 1
      }
      const List = ordered ? 'ol' : 'ul'
      blocks.push(<List key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</List>)
      continue
    }
    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !/^(#{1,4})\s+|^```|^>|^\||^---$|^[-*]\s+|^\d+\.\s+/.test(lines[index].trim())) { paragraph.push(lines[index].trim()); index += 1 }
    blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(paragraph.join(' '))}</p>)
  }
  return blocks
}

const documentConfigs: Record<DocumentId, { title: string; eyebrow: string; summary: string; content: string; version: string }> = {
  user: { title: 'ForgeMind 用户使用文档', eyebrow: 'USER / GUIDE', summary: '从准备启动、注册登录到建造、生产、物流、诊断和排障，按实际界面一步步使用 ForgeMind。', content: userGuideMarkdown, version: 'BUILD 0.1.0 · SAVE V6' },
  technical: { title: '功能模块技术说明', eyebrow: 'TECH / REFERENCE', summary: '记录前端、仿真、三维场景、存档、后端、Agent 和可选 AI 服务的实际模块边界。', content: technicalMarkdown, version: 'ARCHITECTURE / 2026.08.31' },
  forgemind: { title: 'ForgeMind 模块用户文档', eyebrow: 'MODULE / FORGEMIND', summary: '从空白工厂开始，完成空间搭建、生产配置、仓储物流、仿真和诊断。', content: forgeMindModuleMarkdown, version: 'MODULE GUIDE / BUILD 0.1.0' },
  forgecloud: { title: 'ForgeCloud 用户文档', eyebrow: 'MODULE / FORGECLOUD', summary: '使用统一云端控制平面管理工作空间、项目版本、资源、发布和协作事实。', content: forgeCloudUserMarkdown, version: 'MODULE GUIDE / V25' },
  forgehub: { title: 'ForgeHub 用户文档', eyebrow: 'MODULE / FORGEHUB', summary: '了解 ForgeHub 资产入口、当前可用边界和未来 3D 资产工作流的准备方式。', content: forgeHubUserMarkdown, version: 'MODULE GUIDE / PREVIEW' },
  forgelab: { title: 'ForgeLab 用户文档', eyebrow: 'MODULE / FORGELAB', summary: '浏览、发布和复用开放工厂社区中的存档、资源与设计经验。', content: forgeLabUserMarkdown, version: 'MODULE GUIDE / BUILD 0.1.0' },
  forgemove: { title: 'ForgeMove 用户文档', eyebrow: 'MODULE / FORGEMOVE', summary: '在微信小程序中查看移动摘要、任务、库存、监控和 ForgeLab 社区动态。', content: forgeMoveUserMarkdown, version: 'MODULE GUIDE / MINI PROGRAM' },
  forgepass: { title: 'ForgePass 用户文档', eyebrow: 'MODULE / FORGEPASS', summary: '使用统一身份入口注册、登录、续登和退出 Forge 生态产品。', content: forgePassUserMarkdown, version: 'MODULE GUIDE / AUTH' },
  'ecosystem-technical': { title: 'Forge 生态模块技术文档', eyebrow: 'TECH / ECOSYSTEM', summary: '统一查看六个 Forge 模块的职责边界、接口、数据流、权限和验证入口。', content: forgeEcosystemTechnicalMarkdown, version: 'ARCHITECTURE / 2026.09.02' },
}

function DocumentReader({ documentId, onNavigateDocs, onNavigateHome }: { documentId: DocumentId; onNavigateDocs: () => void; onNavigateHome: () => void }) {
  const config = documentConfigs[documentId]
  const blocks = useMemo(() => markdownBlocks(config.content), [config.content])
  const sections = useMemo(() => config.content.split(/\r?\n/).filter((line) => /^##\s+/.test(line)).map((line) => line.replace(/^##\s+/, '').replace(/\s+#$/, '')), [config.content])

  return (
    <section className="fmi-doc-reader" aria-labelledby="fmi-document-title">
      <div className="fmi-doc-reader-head fmi-enter"><div className="fmi-doc-breadcrumb"><button type="button" onClick={onNavigateDocs}>DOCUMENT / INDEX</button><span>/</span><span>{config.eyebrow}</span></div><h1 id="fmi-document-title">{config.title}</h1><p>{config.summary}</p><div className="fmi-doc-meta"><span>{config.version}</span><span>OFFICIAL DOCUMENT</span><span>UPDATED 2026.09.02</span></div><a className="fmi-doc-download-link" href="/docs/ForgeMind-官方文档.pdf" download><PortalMorphIcon icon={DownloadData} activeIcon={ArrowDownData} size={15} /> 下载完整官方文档 PDF</a></div>
      <div className="fmi-doc-reader-layout"><aside className="fmi-doc-toc fmi-enter"><span>ON THIS PAGE</span>{sections.map((section) => <a key={section} href={`#${slugifyHeading(section)}`}>{section}</a>)}<button type="button" onClick={onNavigateHome}>返回官网首页 <PortalMorphIcon icon={ArrowUpRightData} size={14} /></button></aside><article className="fmi-doc-body fmi-enter">{blocks}</article></div>
    </section>
  )
}

function PortalRoutePage({ page, postId, isForgeLabAuthenticated, onEnterWorkspace, onNavigateHome, onNavigateDocs, onNavigatePost, onNavigateForgeLab, onNavigateForgeHub }: { page: Exclude<PortalPage, 'home'>; postId?: string; isForgeLabAuthenticated: boolean; onEnterWorkspace: () => void; onNavigateHome: () => void; onNavigateDocs: () => void; onNavigatePost: (postId: string) => void; onNavigateForgeLab: () => void; onNavigateForgeHub: () => void }) {
  if (page.startsWith('docs-')) {
    return <DocumentReader documentId={page.slice(5) as DocumentId} onNavigateDocs={onNavigateDocs} onNavigateHome={onNavigateHome} />
  }

  if (page === 'product') {
    return (
      <section className="fmi-route-page fmi-product-page" aria-labelledby="fmi-route-title">
        <div className="fmi-product-hero">
          <div className="fmi-route-heading fmi-enter"><span className="fmi-route-eyebrow"><PortalMorphIcon icon={FactoryData} activeIcon={ArrowUpRightData} size={15} /> PRODUCT / INTRO</span><h1 id="fmi-route-title">不是一张示意图，<br /><em>是一座会运行的工厂。</em></h1><p>ForgeMind 把空间设计、生产物流、确定性仿真、智能诊断和开放社区放进同一个可操作的数字工厂系统。让方案在落地之前先被搭建、运行、验证，再把经验交给下一座工厂。</p><div className="fmi-product-hero-actions"><button className="fmi-button fmi-button-primary" type="button" onClick={onEnterWorkspace}>进入数字工厂 <PortalMorphIcon icon={ArrowUpRightData} activeIcon={ArrowRightData} size={16} /></button><span><PortalMorphIcon icon={ShieldCheckData} activeIcon={ActivityData} size={15} /> 规则默认运行 · AI 可选接入</span></div></div>
          <div className="fmi-product-monitor fmi-enter" aria-label="ForgeMind A-01 数字工厂工作台预览"><div className="fmi-monitor-head"><span><i /> A-01 / LIVE WORKSPACE</span><small>3 FLOORS · 1M GRID</small></div><div className="fmi-monitor-screen"><img src="/photos/1.png" alt="A-01 数字工厂工作台预览" /><div className="fmi-monitor-scan" /><span className="fmi-monitor-tag fmi-monitor-tag-a">MATERIAL FLOW</span><span className="fmi-monitor-tag fmi-monitor-tag-b">DIAGNOSTICS READY</span><b className="fmi-monitor-cross fmi-monitor-cross-a" /><b className="fmi-monitor-cross fmi-monitor-cross-b" /></div><div className="fmi-monitor-foot"><span>OBJECTS <strong>READY</strong></span><span>SIMULATION <strong>DETERMINISTIC</strong></span><span>STATUS <strong>ONLINE</strong></span></div></div>
        </div>

        <div className="fmi-product-statement fmi-enter"><span className="fmi-route-eyebrow">THE DIGITAL FACTORY LOOP</span><h2>从“看起来可行”<br />到“运行起来可验证”。</h2><p>设计不是终点。ForgeMind 让每一台设备、每一段物流、每一个库存变化，都进入同一条可追踪的运行链路。</p></div>

        <div className="fmi-product-pillars">{productPillars.map(({ eyebrow, title, body, icon }, index) => <article className="fmi-product-pillar fmi-enter" key={eyebrow}><div className="fmi-pillar-index">0{index + 1}</div><PortalMorphIcon className="fmi-pillar-icon" icon={icon} activeIcon={ArrowUpRightData} size={25} strokeWidth={1.5} /><span>{eyebrow}</span><h3>{title}</h3><p>{body}</p></article>)}</div>

        <div className="fmi-product-catalog"><div className="fmi-product-section-head fmi-enter"><div><span className="fmi-route-eyebrow"><PortalMorphIcon icon={CircuitBoardData} activeIcon={WorkflowData} size={15} /> CAPABILITY MAP / 16 MODULES</span><h2>从一张网格，到一套完整的工厂运行系统。</h2></div><p>每个模块都对应实际工作区、确定性引擎、持久化能力或社区入口，组合起来才是 ForgeMind。</p></div><div className="fmi-module-grid">{productModules.map(({ eyebrow, title, body, detail, icon }, index) => <article className="fmi-module-card fmi-enter" key={eyebrow}><div className="fmi-module-card-head"><PortalMorphIcon icon={icon} activeIcon={ArrowUpRightData} size={19} strokeWidth={1.6} /><span>{eyebrow}</span><b>{String(index + 1).padStart(2, '0')}</b></div><h3>{title}</h3><p>{body}</p><small>{detail}</small></article>)}</div></div>

        <div className="fmi-product-boundary fmi-enter"><div><span className="fmi-route-eyebrow"><PortalMorphIcon icon={ShieldCheckData} activeIcon={SparklesData} size={15} /> RUNTIME PRINCIPLE</span><h2>AI 可以缺席，<br /><em>工厂不能停。</em></h2></div><div className="fmi-boundary-copy"><p>布局坐标、碰撞结论、物料数量、寻路结果和仿真指标都由本地确定性规则负责。AI 只在被显式启用时参与解释、提取受限规格或润色报告。</p><div><span><strong>RULE</strong> 核心引擎默认可用</span><span><strong>AI</strong> 可选服务，不进入仿真 tick</span><span><strong>REVIEW</strong> Patch 必须人工审批</span></div></div></div>

        <div className="fmi-product-flow fmi-enter"><div className="fmi-flow-heading"><span className="fmi-route-eyebrow"><PortalMorphIcon icon={WorkflowData} activeIcon={ArrowRightData} size={15} /> HOW IT RUNS</span><h2>一条从设计到改进的闭环。</h2></div><div className="fmi-flow-track"><div><b>01</b><strong>设计</strong><span>网格、楼层、设备、物品</span></div><i /><div><b>02</b><strong>运行</strong><span>物料、库存、节拍、车辆</span></div><i /><div><b>03</b><strong>诊断</strong><span>瓶颈、断线、背压、异常</span></div><i /><div><b>04</b><strong>改进</strong><span>方案、审批、应用、回滚</span></div></div></div>

        <div className="fmi-product-proof fmi-enter"><div><span className="fmi-route-eyebrow">BUILT FOR VERIFICATION</span><h2>每个结论，都应该能回到工厂现场。</h2></div><div className="fmi-proof-list"><span><PortalMorphIcon icon={GaugeData} activeIcon={ActivityData} size={17} /><strong>确定性仿真</strong><small>相同存档与种子，可复现相同结果</small></span><span><PortalMorphIcon icon={ActivityData} activeIcon={RouteData} size={17} /><strong>实时信号</strong><small>从设备状态到物料流，持续观察变化</small></span><span><PortalMorphIcon icon={ShieldCheckData} activeIcon={ArrowUpRightData} size={17} /><strong>人工审核</strong><small>Agent 只提出方案，不替你决定事实</small></span></div></div>

        <div className="fmi-product-surface fmi-enter"><div className="fmi-product-surface-head"><span className="fmi-route-eyebrow"><PortalMorphIcon icon={WorkflowData} activeIcon={ArrowRightData} size={15} /> ONE SYSTEM / THREE SURFACES</span><h2>从现场搭建，到团队复用。</h2><p>ForgeMind 的价值不止是把设备放进三维空间，而是让每个决定都留下可以运行、检查和分享的证据。</p></div><div className="fmi-surface-grid"><article><PortalMorphIcon icon={FactoryData} activeIcon={ArrowUpRightData} size={19} /><strong>工作台</strong><span>在 1m 网格里构建真实生产空间。</span></article><article><PortalMorphIcon icon={GaugeData} activeIcon={ActivityData} size={19} /><strong>验证层</strong><span>用仿真、诊断和审批识别下一步动作。</span></article><article><PortalMorphIcon icon={OrbitData} activeIcon={SparklesData} size={19} /><strong>开放层</strong><span>在 ForgeLab 共享存档、资源和设计判断。</span></article></div></div>

        <div className="fmi-route-callout fmi-enter"><div><span className="fmi-route-eyebrow">FORGEMIND / A-01</span><h2>让下一条产线，先在数字世界开始。</h2><p>从一张空白网格开始，建立你的第一个可运行工厂。</p></div><button className="fmi-panel-primary" type="button" onClick={onEnterWorkspace}>进入数字工厂 <PortalMorphIcon icon={ArrowUpRightData} activeIcon={ArrowRightData} size={16} /></button></div>
      </section>
    )
  }

  if (page === 'docs') {
    return (
      <section className="fmi-route-page fmi-docs-page" aria-labelledby="fmi-route-title">
      <div className="fmi-route-heading fmi-enter"><span className="fmi-route-eyebrow"><PortalMorphIcon icon={BookOpenData} activeIcon={ArrowUpRightData} size={15} /> DOCUMENT / INDEX</span><h1 id="fmi-route-title">官方文档</h1><p>核心手册、六个 Forge 模块用户指南和生态技术边界，都集中在这里。</p></div>
      <div className="fmi-route-docs fmi-enter">{docs.map(({ eyebrow, title, body, href, icon }) => <a className="fmi-doc-card" key={href} href={href}><span className="fmi-doc-card-icon"><PortalMorphIcon icon={icon} activeIcon={ArrowUpRightData} size={18} strokeWidth={1.7} /></span><span><small>{eyebrow}</small><strong>{title}</strong><em>{body}</em></span><PortalMorphIcon icon={ArrowUpRightData} activeIcon={ArrowRightData} size={16} /></a>)}</div>
      <div className="fmi-doc-download-panel fmi-enter"><div><span className="fmi-route-eyebrow"><PortalMorphIcon icon={DownloadData} activeIcon={ArrowDownData} size={15} /> OFFLINE REFERENCE</span><h2>带走一份完整的官方文档。</h2><p>汇总核心手册、六个模块用户指南和生态技术说明，适合离线阅读、交接和评审。</p></div><a className="fmi-button fmi-button-primary" href="/docs/ForgeMind-官方文档.pdf" download>下载官方文档 PDF <PortalMorphIcon icon={DownloadData} activeIcon={ArrowDownData} size={16} /></a><small>PDF · 2026.09.02 · OFFICIAL RELEASE</small></div>
      <div className="fmi-route-note fmi-enter"><PortalMorphIcon icon={FileTextData} activeIcon={BookOpenData} size={18} /><span>文档会随实际代码和验证结果持续更新。</span></div>
      </section>
    )
  }

  if (page === 'forgelab') {
    return isForgeLabAuthenticated
      ? <ForgeLabPage onNavigatePost={onNavigatePost} />
      : <ForgePassPage onBack={onNavigateHome} onSuccess={onNavigateForgeLab} onEnterWorkspace={onEnterWorkspace} />
  }

  if (page === 'forgelab-post') {
    return isForgeLabAuthenticated
      ? <ForgeLabPostPage postId={postId ?? ''} onBack={onNavigateForgeLab} onEnterWorkspace={onEnterWorkspace} onNavigatePost={onNavigatePost} />
      : <ForgePassPage onBack={onNavigateHome} onSuccess={() => onNavigatePost(postId ?? '')} onEnterWorkspace={onEnterWorkspace} />
  }

  if (page === 'forgehub') {
    return <ForgePassPage onBack={onNavigateHome} onSuccess={onNavigateForgeHub} onEnterWorkspace={onEnterWorkspace} />
  }

  return null
}

export function ForgeMindIntro({ onEnterWorkspace, onOpenForgeCloud }: ForgeMindIntroProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [currentPage, setCurrentPage] = useState<PortalPage>(() => pageFromPath(window.location.pathname))
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const authPhase = useAuthStore((state) => state.phase)

  useEffect(() => {
    const root = rootRef.current
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const targets = root.querySelectorAll('.fmi-enter')
    if (targets.length) {
      animate(targets, {
        opacity: [0, 1],
        translateY: [22, 0],
        delay: stagger(85, { start: 130 }),
        duration: 820,
        ease: 'out(4)',
      })
    }
  }, [currentPage])

  useEffect(() => {
    const onPopState = () => {
      setCurrentPage(pageFromPath(window.location.pathname))
      setMobileNavOpen(false)
      rootRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigateToPage = (page: PortalPage) => {
    const path = page === 'home' ? '/' : `/${page}`
    window.history.pushState({}, '', path)
    setCurrentPage(page)
    setMobileNavOpen(false)
    rootRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const navigateToPost = (postId: string) => {
    window.history.pushState({}, '', `/forgelab/post/${encodeURIComponent(postId)}`)
    setCurrentPage('forgelab-post')
    setMobileNavOpen(false)
    rootRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const navigateToForgeLabAccess = () => navigateToPage('forgelab')

  const navigateToForgeHubAccess = () => navigateToPage('forgehub')

  const enterForgeHub = () => {
    const token = localStorage.getItem('forgemind.token')
    if (!token) {
      navigateToPage('forgehub')
      return
    }
    const configuredUrl = (import.meta.env.VITE_FORGEHUB_URL as string | undefined)?.trim()
    const target = new URL(configuredUrl || `http://${window.location.hostname || '127.0.0.1'}:3000/`)
    target.hash = new URLSearchParams({ token, api: BACKEND_BASE }).toString()
    window.location.assign(target.toString())
  }

  const scrollToHero = () => navigateToPage('home')

  return (
    <div className="fmi-page" data-forgelab={currentPage === 'forgelab' || currentPage === 'forgelab-post' ? 'true' : 'false'} ref={rootRef}>
      <div className="fmi-noise" aria-hidden="true" />
      <div className="fmi-dot-field" aria-hidden="true" />

      <header className="fmi-nav fmi-enter">
        <button className="fmi-brand" type="button" onClick={scrollToHero} aria-label="返回 ForgeMind 首页">
          <img src="/brand/forgemind-emblem.png" alt="" />
          <span>
            <img src="/brand/forgemind-wordmark.png" alt="ForgeMind" />
            <small>DIGITAL FACTORY OS</small>
          </span>
        </button>

        <nav className="fmi-nav-links" aria-label="官网导航">
          {navItems.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" className={(currentPage === id || (id === 'forgelab' && currentPage === 'forgelab-post')) ? 'is-active' : ''} onClick={() => id === 'forgecloud' ? onOpenForgeCloud() : id === 'forgelab' ? navigateToForgeLabAccess() : id === 'forgehub' ? navigateToForgeHubAccess() : navigateToPage(id)}>
              <PortalMorphIcon aria-hidden="true" icon={Icon} activeIcon={ArrowUpRightData} size={15} strokeWidth={1.7} />
              {label}
            </button>
          ))}
        </nav>

        <div className="fmi-nav-actions">
          <button className="fmi-nav-cta" type="button" onClick={onEnterWorkspace}>
            <span>01</span>
            <span>进入工作台</span>
            <PortalMorphIcon aria-hidden="true" icon={ArrowUpRightData} activeIcon={ArrowRightData} size={16} strokeWidth={1.8} />
          </button>
          <button className="fmi-mobile-menu-button" type="button" onClick={() => setMobileNavOpen((value) => !value)} aria-label={mobileNavOpen ? '关闭导航' : '打开导航'} aria-expanded={mobileNavOpen}>
            <MorphingIcon aria-hidden="true" icon={mobileNavOpen ? XData : MenuData} size={19} />
          </button>
        </div>
      </header>

      {mobileNavOpen && (
        <nav className="fmi-mobile-nav" aria-label="移动端官网导航">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => id === 'forgecloud' ? onOpenForgeCloud() : id === 'forgelab' ? navigateToForgeLabAccess() : id === 'forgehub' ? navigateToForgeHubAccess() : navigateToPage(id)}>
              <PortalMorphIcon aria-hidden="true" icon={Icon} activeIcon={ArrowUpRightData} size={16} strokeWidth={1.8} />
              <span>{label}</span>
              <PortalMorphIcon aria-hidden="true" icon={ArrowUpRightData} activeIcon={ArrowRightData} size={15} />
            </button>
          ))}
        </nav>
      )}

      <main>
        {currentPage === 'home' ? <section className="fmi-hero" aria-labelledby="fmi-title">
          <div className="fmi-hero-copy">
            <h1 id="fmi-title" className="fmi-title fmi-enter">让工厂<br /><em>先运行</em>在数字世界。</h1>
            <div className="fmi-hero-actions fmi-enter">
              <button className="fmi-button fmi-button-primary" type="button" onClick={onEnterWorkspace}>进入数字工厂 <PortalMorphIcon aria-hidden="true" icon={ArrowUpRightData} activeIcon={ArrowRightData} size={16} /></button>
              <button className="fmi-button fmi-button-quiet" type="button" onClick={() => navigateToPage('product')}>了解 ForgeMind <PortalMorphIcon className="fmi-button-arrow" icon={ArrowDownData} activeIcon={ArrowRightData} aria-hidden="true" size={16} /></button>
            </div>
            <div className="fmi-hero-signal" aria-label="ForgeMind 工作闭环">
              <span><PortalMorphIcon icon={Layers3Data} activeIcon={FactoryData} size={14} /><b>SPACE</b></span>
              <i />
              <span><PortalMorphIcon icon={RouteData} activeIcon={WorkflowData} size={14} /><b>FLOW</b></span>
              <i />
              <span><PortalMorphIcon icon={GaugeData} activeIcon={ActivityData} size={14} /><b>SIGNAL</b></span>
            </div>
          </div>

          <div className="fmi-hero-visual fmi-enter" aria-label="ForgeMind A-01 数字工厂预览">
            <div className="fmi-visual-orbit fmi-visual-orbit-one" />
            <div className="fmi-visual-orbit fmi-visual-orbit-two" />
            <div className="fmi-factory-lens">
              <div className="fmi-ball-backdrop" />
              <EmotionBallHero />
              <div className="fmi-factory-inset">
                <img src="/photos/1.png" alt="ForgeMind A-01 三维工厂工作台预览" />
                <span>LIVE / A-01</span>
              </div>
              <span className="fmi-lens-corner fmi-lens-corner-tl" />
              <span className="fmi-lens-corner fmi-lens-corner-br" />
              <div className="fmi-lens-readout"><span>EMOTION RUNTIME / BT-7274</span><strong>READY TO FEEL</strong><small>SVG · 32 STATES · LIVE MOTION</small></div>
              <div className="fmi-lens-status"><i /> RUNTIME ONLINE</div>
            </div>
            <div className="fmi-visual-caption"><span>INPUT</span><div className="fmi-route-track"><i /><i /><i /><i /><b /></div><span>OUTPUT</span></div>
          </div>
        </section> : <PortalRoutePage page={currentPage} postId={currentPage === 'forgelab-post' ? postIdFromPath(window.location.pathname) : undefined} isForgeLabAuthenticated={authPhase === 'factory'} onEnterWorkspace={onEnterWorkspace} onNavigateHome={() => navigateToPage('home')} onNavigateDocs={() => navigateToPage('docs')} onNavigatePost={navigateToPost} onNavigateForgeLab={() => navigateToPage('forgelab')} onNavigateForgeHub={enterForgeHub} />}

        <div className="fmi-hero-rail" aria-label="ForgeMind 产品闭环">
          <span>DESIGN</span><PortalMorphIcon className="fmi-rail-arrow" icon={ArrowRightData} activeIcon={ArrowUpRightData} aria-hidden="true" size={14} /><span>SIMULATE</span><PortalMorphIcon className="fmi-rail-arrow" icon={ArrowRightData} activeIcon={ArrowUpRightData} aria-hidden="true" size={14} /><span>DIAGNOSE</span><PortalMorphIcon className="fmi-rail-arrow" icon={ArrowRightData} activeIcon={ArrowUpRightData} aria-hidden="true" size={14} /><span>IMPROVE</span><i /><small>工厂先于现实开始运行</small>
        </div>
      </main>

      <footer className="fmi-footer">
        <div className="fmi-footer-main"><div className="fmi-footer-brand"><div className="fmi-brand-stack" aria-label="ForgeMind 生态产品"><div className="fmi-brand-row fmi-brand-row-primary"><img src="/brand/forgemind-emblem.png" alt="" /><div><strong>ForgeMind</strong><small>DIGITAL FACTORY OS</small></div></div><div className="fmi-brand-row"><img src="/brand/forgecloud-emblem.png" alt="" /><div><strong>ForgeCloud</strong><small>INDUSTRIAL INTELLIGENCE CLOUD</small></div></div><div className="fmi-brand-row"><img src="/brand/forgehub-emblem.png" alt="" /><div><strong>ForgeHub</strong><small>3D ASSET BUILDER</small></div></div><div className="fmi-brand-row"><img src="/brand/forgelab-emblem.png" alt="" /><div><strong>ForgeLab</strong><small>OPEN FACTORY COMMUNITY</small></div></div><div className="fmi-brand-row"><img src="/brand/forgemove-emblem.png" alt="" /><div><strong>ForgeMove</strong><small>MOBILE FIELD APP</small></div></div></div></div><div className="fmi-footer-block"><small>产品入口</small><button type="button" onClick={() => navigateToPage('product')}>产品介绍 <PortalMorphIcon icon={ArrowUpRightData} activeIcon={ArrowRightData} size={12} /></button><button type="button" onClick={onEnterWorkspace}>进入数字工厂 <PortalMorphIcon icon={ArrowUpRightData} activeIcon={ArrowRightData} size={12} /></button></div><div className="fmi-footer-block"><small>官方文档</small><button type="button" onClick={() => navigateToPage('docs')}>文档中心 <PortalMorphIcon icon={ArrowUpRightData} activeIcon={ArrowRightData} size={12} /></button><a href="/docs/ForgeMind-官方文档.pdf" download>下载 PDF <PortalMorphIcon icon={DownloadData} activeIcon={ArrowDownData} size={12} /></a></div><div className="fmi-footer-block"><small>社区与项目</small><button type="button" onClick={navigateToForgeHubAccess}>ForgeHub <PortalMorphIcon icon={ArrowUpRightData} activeIcon={ArrowRightData} size={12} /></button><button type="button" onClick={onOpenForgeCloud}>ForgeCloud <PortalMorphIcon icon={CloudData} activeIcon={ArrowUpRightData} size={12} /></button><button type="button" onClick={() => navigateToPage('forgelab')}>ForgeLab <PortalMorphIcon icon={ArrowUpRightData} activeIcon={ArrowRightData} size={12} /></button><a href="https://github.com/YJsnz/forgemind" target="_blank" rel="noreferrer">GitHub 项目 <PortalMorphIcon icon={ArrowUpRightData} activeIcon={ArrowRightData} size={12} /></a></div><div className="fmi-footer-block"><small>联系与合作</small><div className="fmi-footer-contact-item"><PortalMorphIcon icon={MailData} activeIcon={ArrowUpRightData} size={13} /><a href="mailto:1478838114@qq.com">1478838114@qq.com</a></div><div className="fmi-footer-contact-item"><PortalMorphIcon icon={MapPinData} activeIcon={ArrowUpRightData} size={13} /><span>China · Open Factory Community</span></div><span>产品建议 · 资源共建 · 技术交流</span></div></div>
        <div className="fmi-footer-bottom"><span>© 2026 ForgeMind Studio</span><span>MADE FOR FACTORIES THAT MOVE</span><span>BUILD 0.1.0 · A-01 · <a href="/docs/ForgeMind-官方文档.pdf" download>DOCS PDF ↓</a></span></div>
      </footer>

    </div>
  )
}
