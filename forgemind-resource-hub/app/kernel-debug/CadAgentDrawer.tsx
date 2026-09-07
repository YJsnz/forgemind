import type { LocalCadAgentApplyMode, LocalCadAgentPlan } from "../../core/agent/LocalCadModelingAgent";

type CadAgentDrawerProps = {
  open: boolean;
  prompt: string;
  plan?: LocalCadAgentPlan;
  applyMode: LocalCadAgentApplyMode;
  busy: boolean;
  onClose: () => void;
  onPromptChange: (prompt: string) => void;
  onAnalyze: () => void;
  onApplyModeChange: (mode: LocalCadAgentApplyMode) => void;
  onApply: () => void;
};

const examples = [
  ["带孔法兰", "建立一个直径 240 mm、厚 28 mm、带中心孔和四个安装孔的钢制法兰"],
  ["加强支架", "建立 320×180×240 mm、带四个底板安装孔的加强型支架"],
  ["滚筒输送线", "设计一条长 4.5 米、宽 900 mm、高 850 mm 的滚筒输送线，包含轴承、齿轮、电机、线缆和调平螺栓"],
  ["加工中心", "设计 1400×1100×1900 mm 的数控加工中心，包含床身、导轨、滚珠丝杠、主轴轴承、伺服齿轮、刀库、线缆和紧固件"],
  ["精细机械臂", "建立 2200×1800×2400 mm 六轴精细机械臂工作单元，包含流线外壳、关节端盖、检修盖、线缆、减速器和两指夹具"],
  ["液压压力机", "建立 2000×1600×2200 mm 液压压力机，包含闭式圆角机架、工作窗口、四导向滑块、上下模、液压缸、泵站、软管、安全光幕和操作箱"],
  ["日常描述示例", "我不懂专业名称，想做一个能固定小电机的东西，大概手掌大，底下留几个安装孔，边角不要太尖"],
] as const;

export function CadAgentDrawer({ open, prompt, plan, applyMode, busy, onClose, onPromptChange, onAnalyze, onApplyModeChange, onApply }: CadAgentDrawerProps) {
  if (!open) return null;
  return <aside className="cad-agent-drawer" aria-label="本地建模 Agent">
    <header><div><p>LOCAL CAD AGENT</p><strong>需求驱动建模</strong></div><button type="button" onClick={onClose} aria-label="关闭建模 Agent">×</button></header>
    <p className="cad-agent-intro">描述它要做什么、希望是什么外形、如何安装以及大概尺寸。Agent 会把日常语言转换为草图、旋转、放样、扫掠、添加和切除等可编辑特征。</p>
    <textarea value={prompt} onChange={(event) => onPromptChange(event.target.value)} disabled={busy} placeholder="例如：做一个包住传感器的流线型外壳，前窄后宽，底部留安装面和四个孔，长约 180 mm" />
    <div className="cad-agent-examples">{examples.map(([label,value])=><button key={label} type="button" onClick={()=>onPromptChange(value)}>{label}</button>)}</div>
    <button className="cad-agent-generate" type="button" onClick={onAnalyze} disabled={busy || !prompt.trim()}>分析需求并生成方案 →</button>
    {plan ? <section className="cad-agent-plan">
      <p>建模方案 · {plan.intent.toUpperCase()}</p>
      <h3>{plan.title}</h3>
      <span>{plan.summary}</span>
      {plan.featureProgram ? <p className="cad-agent-program-badge">特征驱动 · 可继续编辑草图与成形顺序</p> : null}
      <div className={`cad-agent-understanding confidence-${plan.understanding.confidence}`}>
        <div><b>我理解的是</b><em>{plan.understanding.confidence === "high" ? "信息充分" : plan.understanding.confidence === "medium" ? "已合理补全" : "建议再补充"}</em></div>
        <p>{plan.understanding.interpretedAs}</p>
        {!!plan.understanding.recognized.length && <section><strong>从描述中识别</strong><ul>{plan.understanding.recognized.map((entry) => <li key={entry}>{entry}</li>)}</ul></section>}
        {!!plan.understanding.inferred.length && <section><strong>Agent 自动补全</strong><ul>{plan.understanding.inferred.map((entry) => <li key={entry}>{entry}</li>)}</ul></section>}
        {!!plan.understanding.warnings.length && <section className="cad-agent-warnings"><strong>应用前请留意</strong><ul>{plan.understanding.warnings.map((entry) => <li key={entry}>{entry}</li>)}</ul></section>}
      </div>
      <dl><div><dt>长</dt><dd>{plan.dimensionsMm.length.toFixed(0)} mm</dd></div><div><dt>宽</dt><dd>{plan.dimensionsMm.width.toFixed(0)} mm</dd></div><div><dt>高</dt><dd>{plan.dimensionsMm.height.toFixed(0)} mm</dd></div></dl>
      <b>步骤</b><ol>{plan.operations.map((operation) => <li key={operation}>{operation}</li>)}</ol>
      <b>假设</b><ul>{plan.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
      <fieldset><legend>应用方式</legend><label><input type="radio" name="cad-agent-mode" value="replace" checked={applyMode === "replace"} onChange={() => onApplyModeChange("replace")} /> 新建模型，替换当前工作内容</label><label><input type="radio" name="cad-agent-mode" value="append" checked={applyMode === "append"} onChange={() => onApplyModeChange("append")} /> 添加到当前项目</label></fieldset>
      <button className="cad-agent-apply" type="button" onClick={onApply} disabled={busy}>{busy ? "正在重建 B-Rep…" : "确认并建立模型"}</button>
    </section> : null}
  </aside>;
}
