import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const component = readFileSync(new URL('../src/components/ProductionWorkspace.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/production.css', import.meta.url), 'utf8')

assert.doesNotMatch(
  component,
  /\[mapFilter,\s*objects\.length,\s*snapshot\.itemLots\.length,\s*tab\]/,
  '实时物料数量不得重启整张地图的入场动画',
)
assert.match(component, /\[mapFilter,\s*objects\.length,\s*tab\]/, '整图动画应只响应地图视图或结构变化')
assert.match(styles, /@keyframes fm-production-lot-pulse/, '物料脉冲应由独立 CSS 动画承载')
assert.match(styles, /prefers-reduced-motion[\s\S]*\.fm-production-moving-lot\s*\{\s*animation:\s*none;/, '物料动画必须尊重减少动态效果设置')

console.log('production map stability regression: PASS')
