import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  Activity as ActivityData,
  Archive as ArchiveData,
  ArrowRight as ArrowRightData,
  ArrowDown as ArrowDownData,
  ArrowUpRight as ArrowUpRightData,
  BadgeCheck as BadgeCheckData,
  Bell as BellData,
  CheckCircle2 as CheckData,
  Box as BoxData,
  Boxes as BoxesData,
  Compass as CompassData,
  Download as DownloadData,
  FileCode2 as FileCode2Data,
  FileText as FileTextData,
  Heart as HeartData,
  Image as ImageData,
  LayoutGrid as LayoutGridData,
  Megaphone as MegaphoneData,
  MessageCircle as MessageCircleData,
  Orbit as OrbitData,
  Paperclip as PaperclipData,
  Plus as PlusData,
  Search as SearchData,
  Send as SendData,
  Sparkles as SparklesData,
  Users as UsersData,
  WandSparkles as WandData,
  X as XData,
} from 'lucide'
import type { MorphIconProps } from 'morphicons/react'
import { EmotionBallHero } from './EmotionBallHero'
import { MorphingIcon } from './MorphingIcon'
import { requestAssistant } from '../game/assistantRuntime'
import { useAuthStore } from '../store/auth'
import { BACKEND_BASE } from '../api/backendBase'
import {
  createForgeLabPost,
  createForgeLabReply,
  loadForgeLabNotifications,
  loadForgeLabPost,
  loadForgeLabPosts,
  markAllForgeLabNotificationsRead,
  markForgeLabNotificationRead,
  toggleForgeLabPostLike,
  toggleForgeLabReplyLike,
  type ForgeLabApiNotification,
  type ForgeLabApiPost,
  type ForgeLabApiReply,
} from '../api/forgeLab'

type ForgeLabPageProps = {
  onEnterWorkspace?: () => void
  onNavigatePost?: (postId: string) => void
}

type ForgeLabIconProps = Omit<MorphIconProps, 'icon'> & {
  icon: MorphIconProps['icon']
  activeIcon?: MorphIconProps['icon']
}

function ForgeLabIcon({ icon, activeIcon, ...props }: ForgeLabIconProps) {
  const [active, setActive] = useState(false)
  return <MorphingIcon
    {...props}
    className={`fl-icon${props.className ? ` ${props.className}` : ''}`}
    icon={active && activeIcon ? activeIcon : icon}
    onPointerEnter={() => activeIcon && setActive(true)}
    onPointerLeave={() => activeIcon && setActive(false)}
  />
}

type LabSectionId = 'archive' | 'models' | 'layout' | 'design' | 'notice'
type LabAttachment = { id?: string; name: string; kind: 'image' | 'archive'; size: string; downloadUrl?: string }
type ForgeLabDraft = { section: LabSectionId; title: string; summary: string; content: string; polishPrompt: string }
export type ForgeLabReply = { id: string; author: string; role: string; content: string; meta: string; likes: number; liked?: boolean }
type ForgeLabNotification = { id: string; kind: 'reply' | 'like' | 'notice'; title: string; body: string; meta: string; read: boolean }
type ForgeLabCommunityState = { likedPostIds: string[]; likedReplyIds: string[]; userReplies: Record<string, ForgeLabReply[]>; notifications: ForgeLabNotification[] }
export type ForgeLabPost = {
  id: string
  section: LabSectionId
  title: string
  summary: string
  content?: string
  author: string
  role: string
  meta: string
  replies: number
  likes: number
  tag: string
  icon: MorphIconProps['icon']
  attachments?: LabAttachment[]
}
const emptyDraft: ForgeLabDraft = { section: 'archive', title: '', summary: '', content: '', polishPrompt: '' }

const labSections: Array<{ id: LabSectionId; label: string; english: string; icon: MorphIconProps['icon']; accent: string }> = [
  { id: 'archive', label: '工厂存档开源', english: 'FACTORY ARCHIVE', icon: ArchiveData, accent: 'purple' },
  { id: 'models', label: '模型资源开源', english: 'MODEL RESOURCES', icon: BoxData, accent: 'cyan' },
  { id: 'layout', label: '布局经验分享', english: 'LAYOUT PRACTICE', icon: LayoutGridData, accent: 'yellow' },
  { id: 'design', label: '设计经验分享', english: 'DESIGN NOTES', icon: CompassData, accent: 'blue' },
  { id: 'notice', label: '设计者公告', english: 'MAKER NOTICE', icon: MegaphoneData, accent: 'orange' },
]

export const labPosts: ForgeLabPost[] = [
  { id: 'wzh-line', section: 'archive', title: 'WZH 三层轻量完整产线：从毛坯到已检成品', summary: '39 个对象、2 台 AGV、2 架跨层无人机，保留真实有限货架和三段可运行工艺，适合作为多楼层物流的起点。', content: '这是一份可以直接打开复盘的三层工厂存档。L1 负责毛坯入库与首段加工，L2 完成中间装配，L3 负责视觉检测和成品出货。每一层都保留清晰的输入、加工、输出关系，避免用演示数据替代真实物流。\n\n存档包含 39 个对象、2 台 AGV、2 架跨层无人机、有限容量货架、存取站和入货/出货边界。固定种子运行 600 秒，实际消耗 196 件钢制毛坯并交付 58 件已检成品。建议先从 L2 的跨层接口开始检查，再观察车辆在库存阈值变化时的接驳。\n\n复用时请保留版本号、随机种子和运行时长，这样其他设计者可以比较自己的布局是否真的改善了吞吐。', author: 'ForgeMind Studio', role: 'MAINTAINER', meta: 'ARCHIVE · 2.4 MB · 2026.08.21', replies: 18, likes: 96, tag: 'FACTORY SAVE', icon: ArchiveData, attachments: [{ name: 'wzh-three-floor.fmsave', kind: 'archive', size: '2.4 MB' }] },
  { id: 'cnc-kit', section: 'models', title: 'CNC Housing 设备模型包与端口说明', summary: '包含模型预览、占地、接口方向和许可说明，下载前可先在资源预览器中检查包围盒。', content: '这个资源包适合需要快速搭建机械加工单元的设计者。模型采用 GLB 格式，按设备本体、接口标记和预览材质拆分，共 6 个文件。导入前建议先检查包围盒、最低点和原点位置，避免模型显示正常但放置足迹偏移。\n\nCNC Housing 的占地、输入端和输出端方向已经在说明页标出。接入传送带时，以端口接触和对象物流方向为准，不要只依赖模型外观判断可连接位置。\n\n许可：CC BY 4.0。使用时请保留原作者署名和来源链接；如果调整了材质、比例或接口，请在自己的分享中写清修改声明。', author: 'Mori', role: 'MODEL MAKER', meta: 'GLB · 6 FILES · CC BY 4.0', replies: 7, likes: 64, tag: 'MODEL KIT', icon: BoxData, attachments: [{ name: 'cnc-housing.glb', kind: 'archive', size: '1.4 MB', downloadUrl: '/models/industrial/cnc_machining_center.glb' }] },
  { id: 'cross-floor', section: 'layout', title: '跨层传送带怎样留出维护通道？', summary: '一条从坡度、楼板净空到 AGV 回转空间的布局复盘，附 1m 网格下的避让检查清单。', content: '跨层物流最容易被忽略的不是坡度，而是坡道落点和维护路径同时占用了同一片空间。我的做法是先锁定 1m 网格，再为坡道保留连续的水平投影，最后把 AGV 回转半径作为不可被设备侵入的通道。\n\n检查顺序建议固定为：一，确认上下楼层接口方向一致；二，检查坡道与楼板底的净空；三，确认落点前后至少留出一个可检查的直段；四，运行确定性仿真，看库存增长时是否出现背压。只要其中一项没有证据，就不要用视觉上的“看起来能过”替代验证。\n\n这套方法并不追求把每一格都塞满，而是让后续换机、查线和定位堵塞都有可走的路径。', author: 'Lin / Layout Lab', role: 'DESIGNER', meta: 'LAYOUT · 8 MIN READ · 2026.08.18', replies: 12, likes: 72, tag: 'FIELD NOTE', icon: LayoutGridData },
  { id: 'signal-first', section: 'design', title: '先画信号，再画设备：数字工厂的设计顺序', summary: '把输入、加工、输出和诊断信号作为第一层关系，设备造型反而会更快收敛。', content: '我把工厂设计拆成三张图：第一张只画物料输入、加工、输出和边界；第二张补上设备足迹、端口和运输方式；第三张才处理模型造型、颜色和动效。这样做的好处是，结构关系不会被漂亮的设备外观带偏。\n\n每一条连接都要能回答三个问题：它从哪里来、交给谁、堵住以后在哪里能看到证据。对于没有下游的开放端，先标记为待处理信号，不要用装饰性的箭头假装已经连通。\n\n设计评审时，我会把目标、约束和验证结果放在同一页。即使方案最后没有采用，也能留下可复用的判断，而不是只留下截图。', author: 'Qiao', role: 'PRODUCT DESIGNER', meta: 'DESIGN · 5 MIN READ · 2026.08.16', replies: 9, likes: 51, tag: 'DESIGN NOTE', icon: CompassData },
  { id: 'resource-rule', section: 'notice', title: 'ForgeLab 资源分享许可与署名规范', summary: '分享工业、公模和私有模型前，请写清来源、许可、修改声明与可使用范围。', content: 'ForgeLab 接受资源分享，但不替作者推断许可。每一份模型、贴图、音频或存档都应注明来源、原始许可、是否修改，以及其他人可以怎样使用。\n\n如果来源不明、许可限制尚未确认，帖子应明确标为“待复核”，不能写成 ForgeMind 原创，也不能承诺可以自由商用。工业资产、公模资产和用户私有模型需要分开说明，附件名称也尽量保留原始版本信息。\n\n遇到不确定的资源，请先分享检查过程和链接，等待作者或维护者补充，而不是删除上下文。可追溯比“看起来完整”更重要。', author: 'ForgeMind Studio', role: 'MAINTAINER', meta: 'NOTICE · 2026.08.15', replies: 4, likes: 38, tag: 'COMMUNITY RULE', icon: MegaphoneData },
  { id: 'inspection-cell', section: 'archive', title: '视觉检测工作台：PCB 检测链路演示档', summary: '一个独立视觉检测单元的演示存档，记录相机、检测结果和离线模型状态的边界。', content: '这是一个独立视觉检测单元的演示存档，重点不是追求一个神奇的检测分数，而是把相机采集、检测结果、合格/不合格分流和离线模型状态边界写清楚。\n\n演示中相机和检测台属于生产链路，离线模型只负责提供可解释的检测辅助结果，不直接改变物料数量、碰撞结论或寻路结果。运行时可以暂停，逐步查看一块 PCB 从进入、检测到分流的状态变化。\n\n复盘时建议记录检测条件、样本范围和失败案例。只附一张成功截图不能说明模型适用于其他工厂，也不能替代真实现场的验证。', author: 'YJ', role: 'BUILDER', meta: 'ARCHIVE · 1.8 MB · 2026.08.12', replies: 6, likes: 43, tag: 'FACTORY SAVE', icon: FileCode2Data, attachments: [{ name: 'inspection-pcb-demo.mp4', kind: 'archive', size: '演示视频', downloadUrl: '/videos/inspection-pcb-demo.mp4' }] },
]

function apiPath(path: string) {
  if (/^https?:\/\//i.test(path) || !path.startsWith('/api/')) return path
  return `${BACKEND_BASE}${path}`
}

function iconForApiPost(post: ForgeLabApiPost): MorphIconProps['icon'] {
  const key = post.iconKey || post.section
  if (key === 'box' || key === 'models') return BoxData
  if (key === 'layout' || key === 'layout-grid') return LayoutGridData
  if (key === 'compass' || key === 'design') return CompassData
  if (key === 'megaphone' || key === 'notice') return MegaphoneData
  if (key === 'file-code') return FileCode2Data
  return ArchiveData
}

function toUiReply(reply: ForgeLabApiReply): ForgeLabReply {
  return { id: reply.id, author: reply.author, role: reply.role, content: reply.content, meta: reply.meta, likes: reply.likes, liked: reply.liked }
}

function toUiPost(post: ForgeLabApiPost): ForgeLabPost {
  const section = labSections.some((item) => item.id === post.section) ? post.section as LabSectionId : 'archive'
  const seedAttachments = labPosts.find((item) => item.id === post.id)?.attachments
  return {
    id: post.id,
    section,
    title: post.title,
    summary: post.summary,
    content: post.content,
    author: post.author,
    role: post.role,
    meta: post.meta,
    replies: post.replies,
    likes: post.likes,
    tag: post.tag,
    icon: iconForApiPost(post),
    attachments: (post.attachments?.length ? post.attachments : seedAttachments?.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      kind: attachment.kind,
      sizeBytes: 0,
      downloadUrl: attachment.downloadUrl || '',
    })))?.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      kind: attachment.kind,
      size: formatFileSize(attachment.sizeBytes),
      downloadUrl: attachment.downloadUrl ? apiPath(attachment.downloadUrl) : undefined,
    })),
  }
}

function toUiNotification(notification: ForgeLabApiNotification): ForgeLabNotification {
  return { id: notification.id, kind: notification.kind, title: notification.title, body: notification.body, meta: notification.meta, read: notification.read }
}

const seedReplies: Record<string, ForgeLabReply[]> = {
  'wzh-line': [
    { id: 'wzh-r1', author: 'Mori', role: 'MODEL MAKER', content: 'L2 跨层接口的方向说明很清楚，尤其是把端口接触和模型外观分开验证，这个提醒很有用。', meta: '2 天前', likes: 12 },
    { id: 'wzh-r2', author: 'Lin / Layout Lab', role: 'DESIGNER', content: '我按你给的种子复跑后，先检查了 L2 的落点，AGV 回转空间确实比视觉上更容易被忽略。', meta: '2 天前', likes: 9 },
    { id: 'wzh-r3', author: 'Qiao', role: 'PRODUCT DESIGNER', content: '建议后续补一张三层输入输出关系图，方便第一次打开存档的人快速定位边界。', meta: '1 天前', likes: 7 },
    { id: 'wzh-r4', author: 'ForgeMind Studio', role: 'MAINTAINER', content: '收到，下一版会把版本号、固定种子和复盘入口放到项目说明里，保持结果可追溯。', meta: '1 天前', likes: 15 },
  ],
  'cnc-kit': [
    { id: 'cnc-r1', author: 'YJ', role: 'BUILDER', content: '这个包的最低点和原点说明解决了我之前导入后足迹偏移的问题，感谢。', meta: '5 天前', likes: 8 },
    { id: 'cnc-r2', author: 'Lin / Layout Lab', role: 'DESIGNER', content: '许可信息写得很完整。调整材质后我会把修改声明和来源链接一起保留。', meta: '4 天前', likes: 6 },
    { id: 'cnc-r3', author: 'Mori', role: 'MODEL MAKER', content: '如果发现接口方向和预览不一致，请带上旋转值和包围盒截图，我会在资源包里补校验表。', meta: '4 天前', likes: 10 },
  ],
  'cross-floor': [
    { id: 'cross-r1', author: 'WZH', role: 'BUILDER', content: '我以前只看坡度，后来在落点前加了一段直线，维护和排查都顺了很多。', meta: '6 天前', likes: 11 },
    { id: 'cross-r2', author: 'ForgeMind Studio', role: 'MAINTAINER', content: '“不要用看起来能过替代验证”很适合做布局评审的检查项，已加入社区建议。', meta: '6 天前', likes: 14 },
    { id: 'cross-r3', author: 'Mori', role: 'MODEL MAKER', content: '如果跨层接口旁边还要放存取站，建议先算 4×4 足迹，再确定坡道落点。', meta: '5 天前', likes: 5 },
  ],
  'signal-first': [
    { id: 'signal-r1', author: 'Lin / Layout Lab', role: 'DESIGNER', content: '三张图的顺序很适合团队评审，先把物流关系钉住，再讨论设备造型。', meta: '8 天前', likes: 13 },
    { id: 'signal-r2', author: 'YJ', role: 'BUILDER', content: '开放端标成待处理信号这点很重要，之前确实会被装饰箭头误导。', meta: '8 天前', likes: 8 },
    { id: 'signal-r3', author: 'Qiao', role: 'PRODUCT DESIGNER', content: '我会把“从哪里来、交给谁、堵住后在哪里有证据”放进下一次设计走查模板。', meta: '7 天前', likes: 12 },
  ],
  'resource-rule': [
    { id: 'rule-r1', author: 'Mori', role: 'MODEL MAKER', content: '同意，来源不明的资源宁可标待复核，也不要为了列表好看直接写成可商用。', meta: '9 天前', likes: 9 },
    { id: 'rule-r2', author: 'ForgeMind Studio', role: 'MAINTAINER', content: '工业资产、公模和私有模型分开记录，后续检索和迁移都会更稳。', meta: '9 天前', likes: 7 },
    { id: 'rule-r3', author: 'Qiao', role: 'PRODUCT DESIGNER', content: '建议附件文件名也带上版本号，这样下载后脱离帖子仍然能找到来源。', meta: '8 天前', likes: 6 },
  ],
  'inspection-cell': [
    { id: 'inspection-r1', author: 'YJ', role: 'BUILDER', content: '演示里把离线模型和仿真事实分开很关键，检测辅助结果不应该改写物料数量。', meta: '12 天前', likes: 10 },
    { id: 'inspection-r2', author: 'WZH', role: 'BUILDER', content: '希望后续能看到一组失败样本，这样比只看通过画面更容易判断边界。', meta: '11 天前', likes: 8 },
    { id: 'inspection-r3', author: 'ForgeMind Studio', role: 'MAINTAINER', content: '会补充检测条件、样本范围和失败案例，保持演示结果可复盘。', meta: '11 天前', likes: 11 },
  ],
}

const LAB_INTERACTION_STORAGE_KEY = 'forgelab-community-interactions-v1'

function emptyCommunityState(): ForgeLabCommunityState {
  return {
    likedPostIds: [],
    likedReplyIds: [],
    userReplies: {},
    notifications: [
      { id: 'welcome-notice', kind: 'notice', title: '欢迎来到 ForgeLab', body: '先阅读约束、来源和验证结果，再下载资源或参与讨论。', meta: '社区公告', read: false },
      { id: 'rule-notice', kind: 'notice', title: '资源许可规范已更新', body: '模型、公模和私有资产请分别注明来源、许可和修改声明。', meta: '社区公告', read: false },
    ],
  }
}

function interactionStorageKey(user: string | null) {
  return `${LAB_INTERACTION_STORAGE_KEY}:${user || 'guest'}`
}

function readCommunityState(user: string | null) {
  if (typeof window === 'undefined') return emptyCommunityState()
  try {
    const stored = window.localStorage.getItem(interactionStorageKey(user))
    if (!stored) return emptyCommunityState()
    const parsed = JSON.parse(stored) as Partial<ForgeLabCommunityState>
    return {
      ...emptyCommunityState(),
      ...parsed,
      likedPostIds: Array.isArray(parsed.likedPostIds) ? parsed.likedPostIds : [],
      likedReplyIds: Array.isArray(parsed.likedReplyIds) ? parsed.likedReplyIds : [],
      userReplies: parsed.userReplies && typeof parsed.userReplies === 'object' ? parsed.userReplies : {},
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : emptyCommunityState().notifications,
    }
  } catch {
    return emptyCommunityState()
  }
}

function saveCommunityState(user: string | null, state: ForgeLabCommunityState) {
  try {
    window.localStorage.setItem(interactionStorageKey(user), JSON.stringify(state))
  } catch {
    // Community interactions remain available in memory when storage is unavailable.
  }
}

function repliesForPost(postId: string, state: ForgeLabCommunityState) {
  return [...(seedReplies[postId] ?? []), ...(state.userReplies[postId] ?? [])]
}

function NotificationCenter({ state, onUpdate }: { state: ForgeLabCommunityState; onUpdate: (updater: (current: ForgeLabCommunityState) => ForgeLabCommunityState) => void }) {
  const [open, setOpen] = useState(false)
  const unread = state.notifications.filter((item) => !item.read).length
  const markAllRead = () => {
    onUpdate((current) => ({ ...current, notifications: current.notifications.map((item) => ({ ...item, read: true })) }))
    void markAllForgeLabNotificationsRead().catch(() => undefined)
  }
  const markRead = (notificationId: string) => {
    onUpdate((current) => ({ ...current, notifications: current.notifications.map((item) => item.id === notificationId ? { ...item, read: true } : item) }))
    void markForgeLabNotificationRead(notificationId).catch(() => undefined)
  }

  return (
    <div className="fl-notification-center">
      <button className={`fl-notification-trigger ${open ? 'is-open' : ''}`} type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}><ForgeLabIcon icon={BellData} activeIcon={MessageCircleData} size={16} /><span>通知</span>{unread ? <b>{unread}</b> : null}</button>
      {open && <div className="fl-notification-panel" role="dialog" aria-label="ForgeLab 通知中心"><header><div><span className="fl-kicker">INBOX / COMMUNITY</span><strong>通知中心</strong></div><button type="button" onClick={markAllRead} disabled={!unread}>全部已读</button></header><div className="fl-notification-list">{state.notifications.length ? state.notifications.map((item) => <button className={`fl-notification-item ${item.read ? '' : 'is-unread'}`} type="button" key={item.id} onClick={() => markRead(item.id)}><span className={`fl-notification-kind fl-notification-kind-${item.kind}`}><ForgeLabIcon icon={item.kind === 'reply' ? MessageCircleData : item.kind === 'like' ? HeartData : BellData} size={14} /></span><span><strong>{item.title}</strong><small>{item.body}</small><em>{item.meta}</em></span>{!item.read && <i />}</button>) : <div className="fl-notification-empty">暂无新通知</div>}</div></div>}
    </div>
  )
}

const LAB_POSTS_STORAGE_KEY = 'forgelab-community-posts-v1'

function readForgeLabPosts() {
  if (typeof window === 'undefined') return labPosts
  try {
    const stored = window.sessionStorage.getItem(LAB_POSTS_STORAGE_KEY)
    if (!stored) return labPosts
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed as ForgeLabPost[] : labPosts
  } catch {
    return labPosts
  }
}

function localForgeLabAnswer(question: string) {
  const normalized = question.toLowerCase()
  if (normalized.includes('发布') || normalized.includes('分享') || normalized.includes('帖子')) return '发布开源内容时，先选择板块，再补齐标题、摘要、资源文件和许可说明。工厂存档建议同时附上版本号、种子和运行结果；模型资源请注明来源、许可与修改声明。'
  if (normalized.includes('模型') || normalized.includes('glb') || normalized.includes('许可')) return '模型资源建议先在工作台资源导入器中检查 GLB 结构、包围盒和最低点，再在帖子里附预览图、占地、接口方向、来源链接和许可。未知许可不要标为可自由商用。'
  if (normalized.includes('布局') || normalized.includes('传送带') || normalized.includes('楼层')) return '布局复盘可以从三件事开始：先固定 1m 网格和设备足迹，再检查端口接触与维护通道，最后用确定性仿真观察背压、库存和车辆路径。AI 只做解释，碰撞和寻路仍以本地规则为准。'
  if (normalized.includes('设计') || normalized.includes('经验')) return '设计经验建议同时写“目标、约束、验证结果”三段：先说要解决什么，再说网格、端口或许可边界，最后附仿真前后差异，让别人可以复现而不是只看结论。'
  return '我是 ForgeLab 的本地工厂分析助手。你可以问我如何分享工厂存档、检查模型许可、复盘布局，或把帖子里的工厂问题带回来一起分析。'
}

function localForgeLabPolish(draft: ForgeLabDraft) {
  const body = draft.content.trim() || draft.summary.trim() || '这是一条 ForgeLab 工厂实践分享。'
  const focus = draft.polishPrompt.trim() || '让内容更清楚、可复现'
  return [
    draft.title.trim() ? '主题：' + draft.title.trim() : '主题：ForgeLab 工厂实践分享',
    body,
    '编辑重点：' + focus + '。建议补充版本、来源、许可和验证结果，方便其他设计者复现。',
  ].join('\n\n')
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export function ForgeLabPage({ onNavigatePost }: ForgeLabPageProps) {
  const [activeSection, setActiveSection] = useState<LabSectionId | 'all'>('all')
  const [posts, setPosts] = useState<ForgeLabPost[]>(readForgeLabPosts)
  const [search, setSearch] = useState('')
  const [question, setQuestion] = useState('')
  const [assistantAnswer, setAssistantAnswer] = useState('本地助手已就绪。可以从资源许可、工厂存档或布局问题开始。')
  const [assistantBusy, setAssistantBusy] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [draft, setDraft] = useState<ForgeLabDraft>(emptyDraft)
  const [imageAttachment, setImageAttachment] = useState<File | null>(null)
  const [archiveAttachment, setArchiveAttachment] = useState<File | null>(null)
  const [polishing, setPolishing] = useState(false)
  const [composerHint, setComposerHint] = useState('')
  const [composerError, setComposerError] = useState('')
  const [publishedNotice, setPublishedNotice] = useState('')
  const [selectedPost, setSelectedPost] = useState<ForgeLabPost | null>(null)
  const currentUser = useAuthStore((state) => state.user)
  const [communityState, setCommunityState] = useState<ForgeLabCommunityState>(() => readCommunityState(currentUser))

  useEffect(() => {
    setCommunityState(readCommunityState(currentUser))
  }, [currentUser])

  useEffect(() => {
    let active = true
    void loadForgeLabPosts().then((remotePosts) => {
      if (!active || !remotePosts.length) return
      const remoteIds = new Set(remotePosts.map((post) => post.id))
      setPosts((current) => [...remotePosts.map(toUiPost), ...current.filter((post) => !remoteIds.has(post.id))])
    }).catch(() => undefined)
    void loadForgeLabNotifications().then((notifications) => {
      if (!active) return
      setCommunityState((current) => ({ ...current, notifications: notifications.map(toUiNotification) }))
    }).catch(() => undefined)
    return () => { active = false }
  }, [currentUser])

  const updateCommunity = (updater: (current: ForgeLabCommunityState) => ForgeLabCommunityState) => {
    setCommunityState((current) => {
      const next = updater(current)
      saveCommunityState(currentUser, next)
      return next
    })
  }

  useEffect(() => {
    try {
      window.sessionStorage.setItem(LAB_POSTS_STORAGE_KEY, JSON.stringify(posts))
    } catch {
      // Session storage is best-effort; the community feed still works in-memory.
    }
  }, [posts])

  const filteredPosts = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return posts.filter((post) => {
      const inSection = activeSection === 'all' || post.section === activeSection
      const inSearch = !keyword || `${post.title} ${post.summary} ${post.author} ${post.tag}`.toLowerCase().includes(keyword)
      return inSection && inSearch
    })
  }, [activeSection, posts, search])

  const openComposer = () => {
    setComposerError('')
    setComposerHint('')
    setPublishedNotice('')
    setComposerOpen(true)
  }

  const openPost = (post: ForgeLabPost) => onNavigatePost ? onNavigatePost(post.id) : setSelectedPost(post)

  const closeComposer = () => {
    if (polishing) return
    setComposerOpen(false)
  }

  const closePost = () => setSelectedPost(null)

  const handleAttachment = (event: ChangeEvent<HTMLInputElement>, kind: LabAttachment['kind']) => {
    const file = event.target.files?.[0] ?? null
    if (kind === 'image') setImageAttachment(file)
    else setArchiveAttachment(file)
    event.target.value = ''
  }

  const polishPost = async () => {
    if (!draft.polishPrompt.trim() || polishing) return
    setPolishing(true)
    setComposerError('')
    setComposerHint('正在用本地工厂助手整理草稿…')
    try {
      const result = await requestAssistant(`ForgeLab 帖子润色请求：${draft.polishPrompt.trim()}

标题：${draft.title}
摘要：${draft.summary}
正文：${draft.content}`)
      const answer = result.answer && !result.answer.includes('规则助手已就绪') ? result.answer.trim() : localForgeLabPolish(draft)
      setDraft((current) => ({ ...current, content: answer }))
      setComposerHint(result.answer && !result.answer.includes('规则助手已就绪') ? 'AI 已生成润色草稿，请检查附件、许可和事实后再发布。' : '已用本地规则生成润色草稿，请检查后再发布。')
    } catch {
      setDraft((current) => ({ ...current, content: localForgeLabPolish(current) }))
      setComposerHint('AI 当前不可用，已用本地规则生成可编辑草稿。')
    } finally {
      setPolishing(false)
    }
  }

  const publishPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = draft.title.trim()
    const summary = draft.summary.trim()
    if (!title || !summary) {
      setComposerError('请先填写标题和摘要，正文与附件可以按需要补充。')
      return
    }
    const section = labSections.find((item) => item.id === draft.section) ?? labSections[0]
    const attachments: LabAttachment[] = [
      imageAttachment ? { name: imageAttachment.name, kind: 'image', size: formatFileSize(imageAttachment.size) } : null,
      archiveAttachment ? { name: archiveAttachment.name, kind: 'archive', size: formatFileSize(archiveAttachment.size) } : null,
    ].filter((item): item is LabAttachment => Boolean(item))
    let newPost: ForgeLabPost
    try {
      const remotePost = await createForgeLabPost({ section: section.id, tag: section.label, title, summary, content: draft.content.trim() }, imageAttachment, archiveAttachment)
      newPost = toUiPost(remotePost)
      setPublishedNotice('帖子和附件已保存到 ForgeLab 社区。')
    } catch {
      newPost = {
        id: `local-${Date.now()}`,
        section: section.id,
        title,
        summary,
        content: draft.content.trim(),
        author: '你',
        role: 'COMMUNITY MAKER',
        meta: `${section.english} · ${attachments.length ? `${attachments.length} ATTACHMENTS` : 'NO ATTACHMENT'} · JUST NOW`,
        replies: 0,
        likes: 0,
        tag: section.label,
        icon: section.icon,
        attachments,
      }
      updateCommunity((current) => ({ ...current, notifications: [{ id: `publish-${newPost.id}`, kind: 'notice', title: '帖子已发布（本地）', body: `《${title}》已加入当前社区流。后端恢复后可重新发布附件。`, meta: '刚刚', read: false }, ...current.notifications] }))
      setPublishedNotice('后端暂时不可用，帖子已保存在当前浏览器会话中。')
    }
    setPosts((current) => [newPost, ...current.filter((post) => post.id !== newPost.id)])
    setActiveSection('all')
    setComposerOpen(false)
    setDraft(emptyDraft)
    setImageAttachment(null)
    setArchiveAttachment(null)
    setComposerHint('')
    setComposerError('')
  }

  const askAssistant = async () => {
    const prompt = question.trim()
    if (!prompt || assistantBusy) return
    setAssistantBusy(true)
    setAssistantAnswer('正在读取 ForgeLab 问题…')
    try {
      const result = await requestAssistant(`ForgeLab 社区问题：${prompt}`)
      const fallback = localForgeLabAnswer(prompt)
      const answer = result.answer && !result.answer.includes('规则助手已就绪') ? result.answer : fallback
      setAssistantAnswer(answer)
    } catch {
      setAssistantAnswer(localForgeLabAnswer(prompt))
    } finally {
      setAssistantBusy(false)
      setQuestion('')
    }
  }

  return (
    <section className="fl-page" aria-labelledby="fl-title">
      <div className="fl-page-glow" aria-hidden="true" />
      <main className="fl-content">
        <section className="fl-hero">
          <div className="fl-hero-logo-wrap">
            <img className="fl-brand-logo" src="/brand/forgelab-logo.png" alt="ForgeLab Open Source Community Lab" />
          </div>
          <div className="fl-hero-copy">
            <span className="fl-kicker"><ForgeLabIcon icon={OrbitData} activeIcon={SparklesData} size={14} /> FORGELAB / OPEN NETWORK</span>
            <h1 id="fl-title">把一座工厂，<br /><em>分享给下一座工厂。</em></h1>
            <p>ForgeLab 是 ForgeMind 的开源社区。分享可复现的工厂存档、模型资源和设计判断，让每一次搭建都能从别人的现场继续。</p>
          </div>
          <div className="fl-hero-publish">
            <span><ForgeLabIcon icon={WandData} activeIcon={ArrowRightData} size={16} /> SHARE FROM THE FLOOR</span>
            <button type="button" onClick={openComposer}><ForgeLabIcon icon={PlusData} activeIcon={ArrowRightData} size={18} /> 发布帖子</button>
            <small>带上图片、工厂存档或模型资源，让下一位设计者可以复现。</small>
          </div>
        </section>

        <div className="fl-lab-grid">
          <aside className="fl-section-rail" aria-label="ForgeLab 社区板块">
            <div className="fl-rail-heading"><span>EXPLORE</span><small>05 CHANNELS</small></div>
            <button className={activeSection === 'all' ? 'is-active' : ''} type="button" onClick={() => setActiveSection('all')}><span className="fl-rail-icon"><ForgeLabIcon icon={BoxesData} activeIcon={OrbitData} size={16} /></span><span><b>全部动态</b><small>ALL ACTIVITY</small></span><strong>{posts.length}</strong></button>
            {labSections.map((section) => (
              <button key={section.id} className={`${activeSection === section.id ? 'is-active' : ''} fl-${section.accent}`} type="button" onClick={() => setActiveSection(section.id)}>
                <span className="fl-rail-icon"><ForgeLabIcon icon={section.icon} activeIcon={ArrowUpRightData} size={16} /></span><span><b>{section.label}</b><small>{section.english}</small></span><strong>{posts.filter((post) => post.section === section.id).length}</strong>
              </button>
            ))}
          </aside>

          <section className="fl-feed" aria-labelledby="fl-feed-title">
            <div className="fl-feed-head"><div><span className="fl-kicker">LATEST / FROM THE FLOOR</span><h2 id="fl-feed-title">最新分享</h2></div><div className="fl-feed-tools"><NotificationCenter state={communityState} onUpdate={updateCommunity} /><label className="fl-search"><ForgeLabIcon icon={SearchData} size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索存档、模型或经验" aria-label="搜索 ForgeLab" /></label></div></div>
            <div className="fl-post-list">
              {filteredPosts.length ? filteredPosts.map((post) => (
                <article className="fl-post-card" key={post.id} role="button" tabIndex={0} aria-label={'阅读：' + post.title} onClick={() => openPost(post)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPost(post) } }}>
                  <div className="fl-post-icon"><ForgeLabIcon icon={post.icon} activeIcon={ArrowUpRightData} size={20} /></div>
                  <div className="fl-post-body"><div className="fl-post-meta"><span>{post.tag}</span><i />{post.meta}</div><h3>{post.title}</h3><p>{post.summary}</p><div className="fl-post-foot"><span><ForgeLabIcon icon={BadgeCheckData} size={13} /> {post.author} <small>{post.role}</small></span><span><ForgeLabIcon icon={MessageCircleData} size={13} /> {repliesForPost(post.id, communityState).length}</span><span><ForgeLabIcon icon={HeartData} size={13} /> {post.likes + (communityState.likedPostIds.includes(post.id) ? 1 : 0)}</span>{post.attachments?.length ? <span><ForgeLabIcon icon={PaperclipData} size={13} /> {post.attachments.length}</span> : null}<span className="fl-read-label">阅读全文 <ForgeLabIcon icon={ArrowRightData} size={12} /></span></div></div>
                  <ForgeLabIcon className="fl-post-arrow" icon={ArrowUpRightData} activeIcon={ArrowRightData} size={16} />
                </article>
              )) : <div className="fl-empty"><ForgeLabIcon icon={SearchData} activeIcon={SparklesData} size={22} /><strong>还没有匹配的分享</strong><span>换个关键词，或回到全部动态。</span></div>}
            </div>
          </section>

          <aside className="fl-sidebar">
            <section className="fl-assistant-card" aria-labelledby="fl-assistant-title">
              <div className="fl-card-top"><span className="fl-assistant-orb"><ForgeLabIcon icon={SparklesData} activeIcon={OrbitData} size={17} /></span><span><small>LOCAL ASSISTANT</small><strong id="fl-assistant-title">ForgeLab 工厂助手</strong></span><i className="fl-online-dot" /></div>
              <p>{assistantAnswer}</p>
              <div className="fl-quick-prompts"><button type="button" onClick={() => setQuestion('怎样分享一个工厂存档？')}>分享存档</button><button type="button" onClick={() => setQuestion('模型资源需要写哪些许可信息？')}>模型许可</button><button type="button" onClick={() => setQuestion('跨层传送带怎样复盘布局？')}>布局复盘</button></div>
              <div className="fl-ask-row"><input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void askAssistant() }} placeholder="描述 ForgeLab 的问题…" aria-label="向 ForgeLab 助手提问" /><button type="button" onClick={() => void askAssistant()} disabled={!question.trim() || assistantBusy} aria-label="发送问题"><ForgeLabIcon icon={SendData} activeIcon={ArrowRightData} size={15} /></button></div>
              <small className="fl-assistant-note"><ForgeLabIcon icon={FileTextData} size={12} /> 规则优先 · 本地可用 · AI 可选润色</small>
            </section>
            <section className="fl-community-card"><span className="fl-kicker"><ForgeLabIcon icon={UsersData} activeIcon={OrbitData} size={13} /> COMMUNITY PRINCIPLES</span><h3>先分享证据，<br /><em>再分享结论。</em></h3><p>好的帖子应该让别人能下载、检查并复现。未知来源、限制性许可和不可验证的指标，会被明确标注。</p></section>
          </aside>
        </div>
      </main>

      <div className="fl-emotion-ball" aria-label="ForgeLab Emotion Ball 助手"><EmotionBallHero /><span>ASK BT-7274</span></div>
      <footer className="fl-footer"><span>FORGELAB / OPEN FACTORY COMMUNITY</span><span>SHARE · TRACE · BUILD TOGETHER</span><span>© 2026 FORGEMIND</span></footer>
      {publishedNotice && <div className="fl-publish-toast" role="status"><ForgeLabIcon icon={CheckData} size={15} /> <span>{publishedNotice}</span><button type="button" onClick={() => setPublishedNotice('')} aria-label="关闭提示"><ForgeLabIcon icon={XData} size={14} /></button></div>}
      {selectedPost && (
        <div className="fl-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePost() }}>
          <article className="fl-post-detail" role="dialog" aria-modal="true" aria-labelledby="fl-post-detail-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="fl-detail-head"><div><span className="fl-kicker"><ForgeLabIcon icon={selectedPost.icon} activeIcon={ArrowRightData} size={15} /> {selectedPost.tag}</span><h2 id="fl-post-detail-title">{selectedPost.title}</h2><div className="fl-detail-byline"><ForgeLabIcon icon={BadgeCheckData} size={13} /> {selectedPost.author} · {selectedPost.role} · {selectedPost.meta}</div></div><button className="fl-icon-button" type="button" onClick={closePost} aria-label="关闭帖子详情"><ForgeLabIcon icon={XData} size={18} /></button></header>
            <p className="fl-detail-summary">{selectedPost.summary}</p>
            <div className="fl-detail-content">{(selectedPost.content || selectedPost.summary).split('\n\n').map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
            {selectedPost.attachments?.length ? <div className="fl-detail-attachments"><span className="fl-kicker"><ForgeLabIcon icon={PaperclipData} size={13} /> ATTACHMENTS</span>{selectedPost.attachments.map((attachment) => <div className="fl-detail-attachment" key={attachment.name}><ForgeLabIcon icon={attachment.kind === 'image' ? ImageData : FileTextData} size={16} /><span><b>{attachment.name}</b><small>{attachment.kind === 'image' ? '图片预览' : '工厂存档 / 资源包'} · {attachment.size}</small></span>{attachment.downloadUrl && !attachment.downloadUrl.includes('/api/forgelab/attachments/') ? <a className="fl-download-button" href={attachment.downloadUrl} download={attachment.name}><ForgeLabIcon icon={DownloadData} activeIcon={ArrowDownData} size={14} /> 下载</a> : <button className="fl-download-button" type="button" onClick={() => void downloadAttachment(attachment)}><ForgeLabIcon icon={DownloadData} activeIcon={ArrowDownData} size={14} /> 下载</button>}</div>)}</div> : null}
            <footer className="fl-detail-actions"><span><ForgeLabIcon icon={MessageCircleData} size={13} /> {selectedPost.replies} 条回复</span><span><ForgeLabIcon icon={ActivityData} size={13} /> {selectedPost.likes} 次喜欢</span><button className="fl-cancel-button" type="button" onClick={closePost}>返回帖子流</button></footer>
          </article>
        </div>
      )}
      {composerOpen && (
        <div className="fl-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeComposer() }}>
          <section className="fl-composer" role="dialog" aria-modal="true" aria-labelledby="fl-composer-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="fl-composer-head"><div><span className="fl-kicker"><ForgeLabIcon icon={WandData} activeIcon={SparklesData} size={14} /> NEW COMMUNITY POST</span><h2 id="fl-composer-title">发布一条帖子</h2><p>把现场、资源和判断写下来，留给下一位设计者。</p></div><button className="fl-icon-button" type="button" onClick={closeComposer} aria-label="关闭发布窗口"><ForgeLabIcon icon={XData} size={18} /></button></header>
            <form onSubmit={publishPost}>
              <div className="fl-composer-grid">
                <label className="fl-field"><span>发布板块</span><select value={draft.section} onChange={(event) => setDraft((current) => ({ ...current, section: event.target.value as LabSectionId }))}>{labSections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}</select></label>
                <label className="fl-field fl-field-wide"><span>标题</span><input required value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="例如：一条更容易维护的跨层物流线" /></label>
                <label className="fl-field fl-field-wide"><span>摘要</span><textarea required rows={2} value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} placeholder="用一两句话说清楚这份分享解决了什么问题。" /></label>
                <label className="fl-field fl-field-wide"><span>正文</span><textarea rows={6} value={draft.content} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} placeholder="记录过程、约束、版本、验证结果或资源说明…" /></label>
                <label className="fl-field fl-field-wide"><span><ForgeLabIcon icon={WandData} size={13} /> AI 润色提示词</span><textarea rows={2} value={draft.polishPrompt} onChange={(event) => setDraft((current) => ({ ...current, polishPrompt: event.target.value }))} placeholder="例如：保持技术事实，语气更清楚，突出可复现步骤" /></label>
              </div>
              <div className="fl-polish-row"><button className="fl-polish-button" type="button" onClick={() => void polishPost()} disabled={!draft.polishPrompt.trim() || polishing}><ForgeLabIcon icon={WandData} activeIcon={SparklesData} size={15} /> {polishing ? '正在润色…' : '让 AI 润色草稿'}</button><small>规则优先 · 本地可用 · AI 可选</small></div>
              <div className="fl-attachment-grid">
                <label className="fl-attachment"><input className="fl-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handleAttachment(event, 'image')} /><span className="fl-attachment-icon"><ForgeLabIcon icon={ImageData} activeIcon={SparklesData} size={17} /></span><span><b>{imageAttachment ? imageAttachment.name : '添加图片'}</b><small>{imageAttachment ? formatFileSize(imageAttachment.size) + ' · 已附加' : 'PNG / JPG / WEBP'}</small></span><ForgeLabIcon icon={PaperclipData} size={14} /></label>
                <label className="fl-attachment"><input className="fl-file-input" type="file" accept=".zip,.json,.fmsave,.forgemind,application/zip,application/json" onChange={(event) => handleAttachment(event, 'archive')} /><span className="fl-attachment-icon fl-attachment-archive"><ForgeLabIcon icon={FileTextData} activeIcon={BoxesData} size={17} /></span><span><b>{archiveAttachment ? archiveAttachment.name : '附带工厂存档 / 资源包'}</b><small>{archiveAttachment ? formatFileSize(archiveAttachment.size) + ' · 已附加' : 'ZIP / JSON / FMSAVE'}</small></span><ForgeLabIcon icon={PaperclipData} size={14} /></label>
              </div>
              {composerHint && <p className="fl-composer-hint" role="status">{composerHint}</p>}
              {composerError && <p className="fl-composer-error" role="alert">{composerError}</p>}
              <footer className="fl-composer-actions"><button className="fl-cancel-button" type="button" onClick={closeComposer}>取消</button><button className="fl-submit-button" type="submit"><ForgeLabIcon icon={ArrowUpRightData} activeIcon={ArrowRightData} size={15} /> 发布帖子</button></footer>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}

async function downloadAttachment(attachment: LabAttachment) {
  if (attachment.downloadUrl?.includes('/api/forgelab/attachments/')) {
    const token = localStorage.getItem('forgemind.token')
    const response = await fetch(attachment.downloadUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!response.ok) throw new Error('附件下载失败')
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = attachment.name
    link.click()
    URL.revokeObjectURL(url)
    return
  }
  const payload = `ForgeLab 附件占位信息\n文件名：${attachment.name}\n类型：${attachment.kind}\n大小：${attachment.size}\n\n正式资源存储接入后，这里将下载原始附件。`
  const url = URL.createObjectURL(new Blob([payload], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = attachment.name + '.txt'
  link.click()
  URL.revokeObjectURL(url)
}

export function ForgeLabPostPage({ postId, onBack, onEnterWorkspace, onNavigatePost }: { postId: string; onBack: () => void; onEnterWorkspace: () => void; onNavigatePost: (postId: string) => void }) {
  const currentUser = useAuthStore((state) => state.user)
  const [posts, setPosts] = useState<ForgeLabPost[]>(readForgeLabPosts)
  const [post, setPost] = useState<ForgeLabPost | null>(() => readForgeLabPosts().find((item) => item.id === postId) ?? null)
  const [remoteReplies, setRemoteReplies] = useState<ForgeLabReply[] | null>(null)
  const [remoteLiked, setRemoteLiked] = useState<boolean | null>(null)
  const [postLoading, setPostLoading] = useState(true)
  const [communityState, setCommunityState] = useState<ForgeLabCommunityState>(() => readCommunityState(currentUser))
  const [replyDraft, setReplyDraft] = useState('')
  const [replyNotice, setReplyNotice] = useState('')
  useEffect(() => {
    setCommunityState(readCommunityState(currentUser))
  }, [currentUser])
  const updateCommunity = (updater: (current: ForgeLabCommunityState) => ForgeLabCommunityState) => {
    setCommunityState((current) => {
      const next = updater(current)
      saveCommunityState(currentUser, next)
      return next
    })
  }

  useEffect(() => {
    let active = true
    setPostLoading(true)
    setPost(readForgeLabPosts().find((item) => item.id === postId) ?? null)
    setRemoteReplies(null)
    setRemoteLiked(null)
    void loadForgeLabPost(postId).then((remotePost) => {
      if (!active) return
      setPost(toUiPost(remotePost))
      setRemoteReplies(remotePost.repliesList?.map(toUiReply) ?? [])
      setRemoteLiked(Boolean(remotePost.liked))
    }).catch(() => undefined).finally(() => {
      if (active) setPostLoading(false)
    })
    void loadForgeLabPosts().then((remotePosts) => {
      if (!active || !remotePosts.length) return
      const remoteIds = new Set(remotePosts.map((item) => item.id))
      setPosts((current) => [...remotePosts.map(toUiPost), ...current.filter((item) => !remoteIds.has(item.id))])
    }).catch(() => undefined)
    void loadForgeLabNotifications().then((notifications) => {
      if (active) setCommunityState((current) => ({ ...current, notifications: notifications.map(toUiNotification) }))
    }).catch(() => undefined)
    return () => { active = false }
  }, [currentUser, postId])

  if (postLoading && !post) {
    return <section className="fl-post-page fl-page"><div className="fl-post-not-found"><span className="fl-kicker"><ForgeLabIcon icon={OrbitData} activeIcon={SparklesData} size={15} /> FORGELAB / LOADING</span><h1>正在打开这条分享…</h1><p>正在从 ForgeLab 社区读取正文、附件和讨论。</p></div></section>
  }
  if (!post) {
    return <section className="fl-post-page fl-page"><div className="fl-post-not-found"><span className="fl-kicker"><ForgeLabIcon icon={OrbitData} activeIcon={SparklesData} size={15} /> FORGELAB / 404</span><h1>这条分享暂时找不到。</h1><p>返回社区流，继续浏览其他工厂现场。</p><button className="fl-post-back-button" type="button" onClick={onBack}><ForgeLabIcon icon={ArrowRightData} size={15} /> 返回 ForgeLab</button></div></section>
  }
  const related = posts.filter((item) => item.id !== post.id).slice(0, 3)
  const replies = remoteReplies ?? repliesForPost(post.id, communityState)
  const liked = remoteLiked ?? communityState.likedPostIds.includes(post.id)
  const togglePostLike = async () => {
    try {
      const result = await toggleForgeLabPostLike(post.id)
      setRemoteLiked(result.liked)
      setPost((current) => current ? { ...current, likes: result.likes } : current)
    } catch {
      updateCommunity((current) => ({
        ...current,
        likedPostIds: liked ? current.likedPostIds.filter((id) => id !== post.id) : [...current.likedPostIds, post.id],
        notifications: liked ? current.notifications : [{ id: `like-${post.id}-${Date.now()}`, kind: 'like', title: '点赞已记录（本地）', body: `你赞了《${post.title}》`, meta: '刚刚', read: false }, ...current.notifications],
      }))
    }
  }
  const toggleReplyLike = async (replyId: string) => {
    if (remoteReplies) {
      try {
        const result = await toggleForgeLabReplyLike(replyId)
        setRemoteReplies((current) => current?.map((reply) => reply.id === replyId ? { ...reply, likes: result.likes, liked: result.liked } : reply) ?? current)
        return
      } catch {
        // Fall through to the browser-only path for a temporarily unavailable backend.
      }
    }
    updateCommunity((current) => ({ ...current, likedReplyIds: current.likedReplyIds.includes(replyId) ? current.likedReplyIds.filter((id) => id !== replyId) : [...current.likedReplyIds, replyId] }))
  }
  const submitReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = replyDraft.trim()
    if (!content) {
      setReplyNotice('写下内容后再发布回复。')
      return
    }
    try {
      const reply = toUiReply(await createForgeLabReply(post.id, content))
      setRemoteReplies((current) => [...(current ?? replies), reply])
      setPost((current) => current ? { ...current, replies: current.replies + 1 } : current)
    } catch {
      const reply: ForgeLabReply = { id: `local-reply-${Date.now()}`, author: currentUser || '你', role: 'COMMUNITY MAKER', content, meta: '刚刚', likes: 0 }
      updateCommunity((current) => ({
        ...current,
        userReplies: { ...current.userReplies, [post.id]: [...(current.userReplies[post.id] ?? []), reply] },
        notifications: [{ id: `reply-${reply.id}`, kind: 'reply', title: '回复已发布（本地）', body: `你参与了《${post.title}》的讨论。`, meta: '刚刚', read: false }, ...current.notifications],
      }))
    }
    setReplyDraft('')
    setReplyNotice('回复已发布，当前账号可继续编辑和查看。')
  }
  return (
    <section className="fl-post-page fl-page" aria-labelledby="fl-post-page-title">
      <div className="fl-page-glow" aria-hidden="true" />
      <main className="fl-post-page-content">
        <div className="fl-post-toolbar"><button className="fl-post-breadcrumb" type="button" onClick={onBack}><ForgeLabIcon icon={ArrowRightData} activeIcon={ArrowUpRightData} size={14} /> FORGELAB / COMMUNITY / BACK TO FEED</button><NotificationCenter state={communityState} onUpdate={updateCommunity} /></div>
        <div className="fl-post-page-grid">
          <article className="fl-post-article">
            <header className="fl-post-article-head"><span className="fl-kicker"><ForgeLabIcon icon={post.icon} activeIcon={ArrowRightData} size={15} /> {post.tag}</span><h1 id="fl-post-page-title">{post.title}</h1><p className="fl-post-article-summary">{post.summary}</p><div className="fl-post-article-byline"><ForgeLabIcon icon={BadgeCheckData} size={13} /> {post.author} · {post.role} · {post.meta}</div></header>
            <div className="fl-post-article-body">{(post.content || post.summary).split('\n\n').map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
            {post.attachments?.length ? <section className="fl-post-downloads"><div className="fl-post-section-label"><ForgeLabIcon icon={PaperclipData} size={13} /> ATTACHMENTS / DOWNLOADS</div>{post.attachments.map((attachment) => <div className="fl-post-download-item" key={attachment.name}><div className="fl-post-download-icon"><ForgeLabIcon icon={attachment.kind === 'image' ? ImageData : FileTextData} size={17} /></div><span><b>{attachment.name}</b><small>{attachment.kind === 'image' ? '图片附件' : '工厂存档 / 资源包'} · {attachment.size}</small></span>{attachment.downloadUrl && !attachment.downloadUrl.includes('/api/forgelab/attachments/') ? <a className="fl-download-button" href={attachment.downloadUrl} download={attachment.name}><ForgeLabIcon icon={DownloadData} activeIcon={ArrowDownData} size={14} /> 下载</a> : <button className="fl-download-button" type="button" onClick={() => void downloadAttachment(attachment)}><ForgeLabIcon icon={DownloadData} activeIcon={ArrowDownData} size={14} /> 下载</button>}</div>)}</section> : null}
            <section className="fl-post-replies" id="fl-replies" aria-labelledby="fl-replies-title"><div className="fl-post-section-label"><ForgeLabIcon icon={MessageCircleData} size={13} /> DISCUSSION / {replies.length}</div><div className="fl-replies-head"><h2 id="fl-replies-title">现场讨论</h2><span>把验证过程、边界和复现结果留在帖子里。</span></div><div className="fl-reply-list">{replies.map((reply) => { const replyLiked = reply.liked ?? communityState.likedReplyIds.includes(reply.id); return <article className="fl-reply" key={reply.id}><div className="fl-reply-avatar"><ForgeLabIcon icon={BadgeCheckData} size={15} /></div><div className="fl-reply-body"><div className="fl-reply-meta"><strong>{reply.author}</strong><span>{reply.role}</span><i />{reply.meta}</div><p>{reply.content}</p><button className={`fl-reply-like ${replyLiked ? 'is-liked' : ''}`} type="button" onClick={() => void toggleReplyLike(reply.id)}><ForgeLabIcon icon={HeartData} size={13} /> {reply.likes + (reply.liked === undefined && replyLiked ? 1 : 0)}</button></div></article> })}</div><form className="fl-reply-form" onSubmit={submitReply}><div className="fl-reply-avatar fl-reply-avatar-you"><ForgeLabIcon icon={UsersData} size={15} /></div><div className="fl-reply-compose"><textarea value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} placeholder="写下你的复现结果、问题或建议…" rows={3} aria-label="发布回复" /><div><small>{replyNotice || '请围绕事实、约束和验证过程交流。'}</small><button className="fl-reply-submit" type="submit"><ForgeLabIcon icon={SendData} activeIcon={ArrowRightData} size={14} /> 发布回复</button></div></div></form></section><footer className="fl-post-article-foot"><button className={`fl-post-like-button ${liked ? 'is-liked' : ''}`} type="button" onClick={() => void togglePostLike()}><ForgeLabIcon icon={HeartData} size={14} /> {post.likes + (remoteLiked === null && liked ? 1 : 0)} {liked ? '已喜欢' : '喜欢'}</button><a href="#fl-replies"><ForgeLabIcon icon={MessageCircleData} size={13} /> {replies.length} 条回复</a><button className="fl-post-back-button" type="button" onClick={onBack}>返回帖子流 <ForgeLabIcon icon={ArrowRightData} size={14} /></button></footer>
          </article>
          <aside className="fl-post-page-aside"><section className="fl-post-aside-card"><span className="fl-kicker"><ForgeLabIcon icon={SparklesData} activeIcon={OrbitData} size={14} /> READ / REUSE / TRACE</span><h2>把现场带回<br /><em>自己的工厂。</em></h2><p>先阅读约束和验证结果，再下载资源。遇到问题，可以让 ForgeLab 工厂助手一起复盘。</p><button className="fl-header-cta" type="button" onClick={onEnterWorkspace}>进入工作台 <ForgeLabIcon icon={ArrowUpRightData} activeIcon={ArrowRightData} size={15} /></button></section><section className="fl-related-posts"><div className="fl-post-section-label">MORE FROM THE FLOOR</div>{related.map((item) => <button key={item.id} type="button" onClick={() => onNavigatePost(item.id)}><span>{item.tag}</span><b>{item.title}</b><ForgeLabIcon icon={ArrowUpRightData} activeIcon={ArrowRightData} size={14} /></button>)}</section></aside>
        </div>
      </main>
      <div className="fl-emotion-ball" aria-label="ForgeLab Emotion Ball 助手"><EmotionBallHero /><span>ASK BT-7274</span></div>
      <footer className="fl-footer"><span>FORGELAB / OPEN FACTORY COMMUNITY</span><span>READ · TRACE · BUILD TOGETHER</span><span>© 2026 FORGEMIND</span></footer>
    </section>
  )
}
