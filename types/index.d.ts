export type Turn = {
  startedAt: number
  tools: number
  isWorking: boolean
  lastSeconds: number | null
}

export type Gauge = {
  tokens: number | null
  window: number
  percent: number | null
  usd: number | null
  fiveHour: number | null
  week: number | null
}

export type Call = {
  id: string
  tool: string
  label: string
  state: 'runs' | 'ok' | 'error' | 'blocked'
}

export type Agent = {
  id: string
  name: string
  task: string
  kind: 'agent' | 'cli' | 'mcp'
  startedAt: number
  endedAt: number | null
  tools: number
  last: string
  state: 'runs' | 'ok' | 'error' | 'bg'
}

declare module 'claude-code' {
  interface PluginState {
    cockpit: {
      agents: Agent[]
      turn: Turn
      gauge: Gauge
      calls: Call[]
      files: string[]
      now: number
      isBandHidden: boolean
      isPaneOpen: boolean
    }
  }
}
