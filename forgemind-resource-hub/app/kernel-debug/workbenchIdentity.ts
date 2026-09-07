let workbenchSequence = 0;

export const createWorkbenchId = (prefix: string) => `${prefix}-${Date.now()}-${++workbenchSequence}`;
export const workbenchTimestamp = () => Date.now();
