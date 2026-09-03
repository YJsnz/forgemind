import { MorphIcon, type MorphIconProps } from 'morphicons/react'

/**
 * Shared animated icon surface. Morphicons consumes Lucide icon data, so the
 * existing lucide-react components remain available for static icons while
 * state-changing icons can morph without changing their button layout.
 */
export function MorphingIcon(props: MorphIconProps) {
  return <MorphIcon reducedMotion="user" spring="snappy" {...props} />
}
