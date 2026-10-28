import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { Agent, Call, Gauge, Turn } from '../types'

const PANE = 'cockpit'
const PANE_TITLE = 'Cockpit'
const WARN_AT = 80

const turn = atom({ plugin: 'cockpit', key: 'turn' } as const, {
  startedAt: 0,
  tools: 0,
  isWorking: false,
  lastSeconds: null,
} as Turn)
const gauge = atom({ plugin: 'cockpit', key: 'gauge' } as const, {
  tokens: null,
  window: 200000,
  percent: null,
  usd: null,
  fiveHour: null,
  week: null,
} as Gauge)
const calls = atom({ plugin: 'cockpit', key: 'calls' } as const, [] as Call[])
const files = atom({ plugin: 'cockpit', key: 'files' } as const, [] as string[])
const now = atom({ plugin: 'cockpit', key: 'now' } as const, 0)
const isBandHidden = atom({ plugin: 'cockpit', key: 'isBandHidden' } as const, false)
const isPaneOpen = atom({ plugin: 'cockpit', key: 'isPaneOpen' } as const, false)
const agents = atom({ plugin: 'cockpit', key: 'agents' } as const, [] as Agent[])

const DELEGATE_NAMES = 'sol|luna|gemini|codex|agy'
const DELEGATES = [
  new RegExp(`delegate\\.m?js\\s+(${DELEGATE_NAMES})\\b`, 'i'),
  new RegExp(`scripts/(${DELEGATE_NAMES})\\.sh\\b`, 'i'),
  new RegExp(`(?:^|[;&|(]\\s*)(?:\\S+=\\S+\\s+)*(${DELEGATE_NAMES})(?:\\.sh)?(?=\\s|$)`, 'i'),
]
const LONG_AGENT_SECONDS = 60

const toGauge = (
  context: SessionContextUsage,
  rateLimits: SessionRateLimit[],
  cost?: SessionCost,
): Gauge => ({
  tokens: context.tokens ?? null,
  window: context.window,
  percent: context.percent ?? null,
  usd: cost?.usd ?? null,
  fiveHour: rateLimits.find(r => r.kind === 'five_hour')?.percentUsed ?? null,
  week: rateLimits.find(r => r.kind === 'seven_day')?.percentUsed ?? null,
})

const kilo = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
const dollars = (usd: number) => `${usd.toFixed(2).replace('.', ',')} $`
const duration = (seconds: number) =>
  seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`
const level = (percent: number) =>
  percent >= WARN_AT ? 'error' : percent >= 50 ? 'warning' : 'success'
const bar = (percent: number, width: number) => {
  const full = Math.round((Math.min(100, percent) / 100) * width)
  return { full: '▰'.repeat(full), empty: '▱'.repeat(width - full) }
}
const baseName = (path: string) => path.split('/').pop() ?? path

const labelOf = (e: { tool: string }) => {
  const args = e as { command?: unknown; file_path?: unknown; pattern?: unknown }
  if (typeof args.command === 'string') return args.command.split('\n')[0].slice(0, 48)
  if (typeof args.file_path === 'string') return baseName(args.file_path)
  if (typeof args.pattern === 'string') return args.pattern.slice(0, 48)
  return ''
}

const externalOf = (e: { tool: string }) => {
  const args = e as { command?: unknown; description?: unknown; run_in_background?: unknown }
  if (e.tool === 'Bash' && typeof args.command === 'string') {
    const command = args.command
    const match = DELEGATES.map(re => re.exec(command)).find(m => m !== null)
    if (match?.[1]) {
      return {
        name: match[1].toLowerCase(),
        kind: 'cli' as const,
        task: typeof args.description === 'string' ? args.description : '',
        isBackground: args.run_in_background === true,
      }
    }
  }
  if (e.tool.startsWith('mcp__') && new RegExp(DELEGATE_NAMES, 'i').test(e.tool)) {
    return { name: e.tool.split('__')[1] ?? e.tool, kind: 'mcp' as const, task: '', isBackground: false }
  }
  return null
}

let ticker: { cancel: () => void } | null = null

async function openPane($: EngineInterface) {
  const { isPlaced } = await $.ui.open({ id: PANE, title: PANE_TITLE })
  await update($, isPaneOpen, () => isPlaced)
}

async function togglePane($: EngineInterface) {
  if (await read($, isPaneOpen)) {
    await $.ui.close({ id: PANE })
    await update($, isPaneOpen, () => false)
  } else {
    await openPane($)
  }
}
const pendingTasks: { type: string; task: string }[] = []

function startTicker($: EngineInterface) {
  if (ticker) return
  ticker = $.clock.every(1000, () => {
    void $.clock.now().then(ms => update($, now, () => ms))
  })
}

async function finishAgent(
  $: EngineInterface,
  id: string,
  state: 'ok' | 'error',
) {
  const endedAt = await $.clock.now()
  const agent = (await read($, agents)).find(a => a.id === id)
  if (!agent || agent.endedAt !== null) return
  await update($, agents, list => list.map(a => (a.id === id ? { ...a, endedAt, state } : a)))

  const seconds = Math.round((endedAt - agent.startedAt) / 1000)
  const verdict = state === 'ok' ? 'a terminé' : 'a échoué'
  $.ui.toast(`${agent.name} ${verdict} en ${duration(seconds)}`)
  if (seconds >= LONG_AGENT_SECONDS) {
    void $.ui.notify(`${agent.task || agent.name} · ${duration(seconds)}`, {
      title: `${agent.name} ${verdict}`,
    })
  }

  const isBusy = (await read($, agents)).some(a => a.state === 'runs')
  if (!isBusy && !(await read($, turn)).isWorking) {
    ticker?.cancel()
    ticker = null
  }
}

export const register: Register = on => {
  let hasWarned = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cockpit',
      description: 'Ouvre le panneau Cockpit (contexte, coût, fichiers, activité)',
    })
    await $.command.register({
      name: 'jauge',
      description: 'Affiche ou masque la jauge de contexte au-dessus du prompt',
    })
    const usage = await $.session.usage()
    await update($, gauge, () => toGauge(usage.context, usage.rateLimits, usage.cost))
    void openPane($)

    return next(e)
  })

  on('command.run', { command: 'cockpit' }, async $ => {
    await openPane($)

    return { text: 'Panneau Cockpit ouvert.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, isPaneOpen, () => false)

    return next(e)
  })

  on('command.run', { command: 'jauge' }, async $ => {
    const wasHidden = await read($, isBandHidden)
    await update($, isBandHidden, () => !wasHidden)

    return { text: wasHidden ? 'Jauge affichée.' : 'Jauge masquée (/jauge pour la remettre).' }
  })

  on('session.measure', async ($, e, next) => {
    const next_ = toGauge(e.context, e.rateLimits, e.cost)
    await update($, gauge, () => next_)

    const percent = next_.percent ?? 0
    if (percent >= WARN_AT && !hasWarned) {
      hasWarned = true
      $.ui.toast(`Contexte à ${percent} % : pense à compacter (bouton dans la jauge)`)
    }
    if (percent < WARN_AT) hasWarned = false

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const finished = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(e.text)?.[1]
    if (finished && e.text.includes('<task-notification>')) {
      const status = /<status>([^<]+)<\/status>/.exec(e.text)?.[1] ?? 'completed'
      await finishAgent($, finished.trim(), status.trim() === 'completed' ? 'ok' : 'error')
    }

    const startedAt = await $.clock.now()
    await update($, turn, t => ({ ...t, startedAt, tools: 0, isWorking: true }))
    await update($, now, () => startedAt)
    startTicker($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (!(await read($, agents)).some(a => a.state === 'runs')) {
      ticker?.cancel()
      ticker = null
    }
    const ended = await $.clock.now()
    const { startedAt, tools } = await read($, turn)
    const seconds = Math.round((ended - startedAt) / 1000)
    await update($, turn, t => ({ ...t, isWorking: false, lastSeconds: seconds }))
    $.ui.status(undefined)

    if (seconds >= 90) {
      $.ui.toast(`Terminé en ${duration(seconds)} · ${tools} outils`)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const call: Call = { id: e.tool_use_id, tool: e.tool, label: labelOf(e), state: 'runs' }
    await update($, calls, list => [...list, call].slice(-100))
    const owner = e.agentId === undefined ? undefined : (await read($, agents)).find(a => a.id === e.agentId)
    if (e.agentId === undefined) {
      await update($, turn, t => ({ ...t, tools: t.tools + 1 }))
    } else {
      const last = `${call.tool}${call.label ? ` ${call.label}` : ''}`
      await update($, agents, list =>
        list.map(a => (a.id === e.agentId ? { ...a, tools: a.tools + 1, last } : a)),
      )
    }
    $.ui.status(`▸ ${owner ? `${owner.name} · ` : ''}${call.tool}${call.label ? ` · ${call.label}` : ''}`)

    if (e.tool === 'Agent') {
      const args = e as { subagent_type?: unknown; description?: unknown }
      pendingTasks.push({
        type: typeof args.subagent_type === 'string' ? args.subagent_type : 'general-purpose',
        task: typeof args.description === 'string' ? args.description : '',
      })
    }

    const external = e.agentId === undefined ? externalOf(e) : null
    if (external) {
      const startedAt = await $.clock.now()
      const agent: Agent = {
        id: e.tool_use_id,
        name: external.name,
        task: external.task || call.label,
        kind: external.kind,
        startedAt,
        endedAt: null,
        tools: 0,
        last: external.task || call.label,
        state: 'runs',
      }
      await update($, agents, list => [...list, agent].slice(-20))
      startTicker($)
    }

    const ran = await next(e)
    const state: Call['state'] =
      ran.deny !== undefined ? 'blocked' : ran.isError === true ? 'error' : 'ok'
    if (external && !external.isBackground) {
      await finishAgent($, e.tool_use_id, state === 'ok' ? 'ok' : 'error')
    }
    await update($, calls, list =>
      list.map(one => (one.id === call.id ? { ...one, state } : one)),
    )

    const path = (e as { file_path?: unknown }).file_path
    const isWrite = e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit'
    if (state === 'ok' && isWrite && typeof path === 'string') {
      await update($, files, list => [path, ...list.filter(p => p !== path)].slice(0, 30))
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStart', async ($, e, next) => {
    const index = pendingTasks.findIndex(p => p.type === e.agent_type)
    const task = index === -1 ? '' : (pendingTasks.splice(index, 1)[0]?.task ?? '')
    const agent: Agent = {
      id: e.agent_id,
      name: e.agent_type,
      task,
      kind: 'agent',
      startedAt: await $.clock.now(),
      endedAt: null,
      tools: 0,
      last: '',
      state: 'runs',
    }
    await update($, agents, list => [...list.filter(a => a.id !== agent.id), agent].slice(-20))
    startTicker($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    await finishAgent($, e.agent_id, 'ok')

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isBandHidden))) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const g = await read($, gauge)
    const t = await read($, turn)
    const ms = await read($, now)
    const percent = g.percent ?? 0
    const { full, empty } = bar(percent, 8)
    const elapsed = Math.max(0, Math.round((ms - t.startedAt) / 1000))
    const running = (await read($, agents)).filter(a => a.state === 'runs').length
    const isOpen = await read($, isPaneOpen)

    return (
      <Box flexDirection="row" alignItems="center">
        <Text wrap="truncate-end">
          <Text color={level(percent)}>{full}</Text>
          <Text color="inactive">{empty}</Text>
          <Text color={level(percent)}> {g.percent === null ? '—' : `${percent}%`}</Text>
          <Text dimColor>
            {g.tokens === null ? '' : ` · ${kilo(g.tokens)}`}
            {g.usd === null ? '' : ` · ${dollars(g.usd).replace(' ', '')}`}
          </Text>
          {t.isWorking && <Text color="claude"> · {duration(elapsed)}</Text>}
          {running > 0 && (
            <Text color="claude" bold> · ◐ {running} agent{running > 1 ? 's' : ''}</Text>
          )}
        </Text>
        {percent >= 70 && !e.props.isWorking && (
          <Button key="compact" label="compacter" plain dimColor onPress={() => void $.session.compact()} />
        )}
        <Button
          key="pane"
          label={isOpen ? ' ▸' : ' ◂'}
          plain
          dimColor={isOpen}
          onPress={() => void togglePane($)}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const g = await read($, gauge)
    const t = await read($, turn)
    const list = await read($, calls)
    const touched = await read($, files)
    const crew = await read($, agents)
    const ms = await read($, now)
    const order = { runs: 0, bg: 1, error: 2, ok: 3 } as const
    const shown = [...crew]
      .sort((a, b) => order[a.state] - order[b.state] || b.startedAt - a.startedAt)
      .slice(0, 6)
    const agentIcon = { runs: '◐', bg: '◌', ok: '✓', error: '✗' } as const
    const agentTint = { runs: 'claude', bg: 'subtle', ok: 'success', error: 'error' } as const
    const agentTime = (a: Agent) =>
      duration(Math.max(0, Math.round(((a.endedAt ?? Math.max(ms, a.startedAt)) - a.startedAt) / 1000)))
    const percent = g.percent ?? 0
    const { full, empty } = bar(percent, 16)
    const room = Math.max(3, Math.min(10, (e.viewport?.rows ?? 30) - 12))
    const icon = { runs: '·', ok: '✓', error: '✗', blocked: '⊘' } as const
    const tint = { runs: 'claude', ok: 'inactive', error: 'error', blocked: 'warning' } as const
    const limits = [
      g.fiveHour === null ? '' : `5h ${Math.round(g.fiveHour)}%`,
      g.week === null ? '' : `7j ${Math.round(g.week)}%`,
    ].filter(Boolean).join(' · ')

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text>
            <Text color={level(percent)}>{full}</Text>
            <Text color="inactive">{empty}</Text>
            <Text color={level(percent)}> {g.percent === null ? '—' : `${percent}%`}</Text>
          </Text>
          <Text dimColor>
            {g.tokens === null ? '—' : kilo(g.tokens)}/{kilo(g.window)}
            {g.usd === null ? '' : ` · ${dollars(g.usd).replace(' ', '')}`}
            {limits ? ` · ${limits}` : ''}
            {t.lastSeconds === null || t.isWorking ? '' : ` · ${duration(t.lastSeconds)}`}
          </Text>
        </Box>

        {shown.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>agents</Text>
            {shown.map(a => (
              <Box flexDirection="column">
                <Text wrap="truncate-end">
                  <Text color={agentTint[a.state]}>{agentIcon[a.state]} </Text>
                  <Text bold={a.state === 'runs'}>{a.name}</Text>
                  <Text dimColor>
                    {' '}
                    {a.state === 'bg' ? 'en fond' : agentTime(a)}
                    {a.kind === 'agent' && a.tools > 0 ? ` · ${a.tools} outils` : ''}
                  </Text>
                </Text>
                {a.state === 'runs' && (a.last || a.task) !== '' ? (
                  <Text dimColor wrap="truncate-end">  {a.last || a.task}</Text>
                ) : null}
              </Box>
            ))}
          </Box>
        )}

        {touched.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>fichiers</Text>
            {touched.slice(0, 6).map(path => (
              <Text wrap="truncate-start">
                <Text color="diffAdded">+ </Text>{baseName(path)}
              </Text>
            ))}
          </Box>
        )}

        {list.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>activité</Text>
            {list.slice(-room).reverse().map(call => (
              <Text wrap="truncate-end">
                <Text color={tint[call.state]}>{icon[call.state]} </Text>
                {call.tool}
                <Text dimColor> {call.label}</Text>
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
