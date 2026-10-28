import { expect, test } from 'claude-code/testing'

const USAGE = {
  startedAt: 0,
  context: { tokens: 84000, window: 200000, percent: 42 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 23 }],
  cost: { usd: 0.83 },
}

const stubs = (on: Parameters<Parameters<typeof test>[1]>[1], asked: string[] = []) => {
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', (_, e) => (asked.push(`open ${e.id}`), { value: { isPlaced: true } }))
  on('ui.close', (_, e) => (asked.push(`close ${e.id}`), { value: undefined }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) => (asked.push(`tool ${e.tool_use_id}`), { result: {} }))
}

test('la jauge montre le contexte et le coût', async ($, on) => {
  stubs(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'cockpit',
      component: 'AbovePrompt',
      surface,
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 120,
        scroll: { offset: 0, bodyRows: 10 },
      },
    } as never)

    expect((await ui.find({ type: 'Text', text: /42%/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /84k · 0,83\$/ })) !== undefined).toBe(true)
    await ui.unmount()
  }
})

test('le panneau liste les outils et les fichiers modifiés', async ($, on) => {
  stubs(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({
    tool: 'Write',
    file_path: '/home/user/projet/meteo.ts',
    content: 'x',
  })

  const ui = await $.ui.mount({
    plugin: 'cockpit',
    component: 'Pane',
    requestId: 'cockpit',
    surface: 'desktop',
    props: {
      title: 'Cockpit',
      isFocused: false,
      bodyColumns: 50,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  } as never)

  expect((await ui.find({ type: 'Text', text: /npm test/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /meteo\.ts/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('les sous-agents et les délégations apparaissent dans la jauge et le panneau', async ($, on) => {
  stubs(on)
  let clock = 1000
  on('clock.now', () => ({ value: (clock += 5000) }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'auto' } }))
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const base = { session_id: 's', transcript_path: '/t', cwd: '/' }
  await $.classic.SubagentStart({ ...base, hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'sol' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/x/meteo.ts', agentId: 'a1' } as never)

  const band = await $.ui.mount({
    plugin: 'cockpit',
    component: 'AbovePrompt',
    surface: 'desktop',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 } },
  } as never)
  expect((await band.find({ type: 'Text', text: /1 agent/ })) !== undefined).toBe(true)
  await band.unmount()

  await $.tool.call({ tool: 'Bash', command: 'gemini -p "résume"' })

  const pane = await $.ui.mount({
    plugin: 'cockpit',
    component: 'Pane',
    requestId: 'cockpit',
    surface: 'desktop',
    props: { title: 'Cockpit', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as never)
  expect((await pane.find({ type: 'Text', text: /^sol$/ })) !== undefined).toBe(true)
  expect((await pane.find({ type: 'Text', text: /Read meteo\.ts/ })) !== undefined).toBe(true)
  expect((await pane.find({ type: 'Text', text: /^gemini$/ })) !== undefined).toBe(true)
  await pane.unmount()

  await $.classic.SubagentStop({ ...base, hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'sol', stop_hook_active: false, agent_transcript_path: '/t2' } as never)
  const after = await $.ui.mount({
    plugin: 'cockpit',
    component: 'AbovePrompt',
    surface: 'desktop',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 } },
  } as never)
  expect((await after.find({ type: 'Text', text: /agent/ })) === undefined).toBe(true)
  await after.unmount()
})

test('la flèche ferme puis rouvre le panneau', async ($, on) => {
  const asked: string[] = []
  stubs(on, asked)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 } }
  const band = await $.ui.mount({ plugin: 'cockpit', component: 'AbovePrompt', surface: 'desktop', props } as never)
  expect((await band.find({ type: 'Button', key: 'pane' }))?.props.label).toBe(' ▸')
  await band.press({ key: 'pane' })
  await band.unmount()
  expect(asked.includes('close cockpit')).toBe(true)

  const again = await $.ui.mount({ plugin: 'cockpit', component: 'AbovePrompt', surface: 'desktop', props } as never)
  expect((await again.find({ type: 'Button', key: 'pane' }))?.props.label).toBe(' ◂')
  await again.press({ key: 'pane' })
  await again.unmount()
  expect(asked.filter(a => a === 'open cockpit').length >= 2).toBe(true)
})

test('Sol lancé en fond par delegate.mjs est suivi jusqu\'à sa notification de fin', async ($, on) => {
  const asked: string[] = []
  stubs(on, asked)
  let clock = 1000
  on('clock.now', () => ({ value: (clock += 5000) }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'auto' } }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.tool.call({
    tool: 'Bash',
    command: 'cd /p/api && node /p/.claude/scripts/delegate.mjs sol /tmp/brief.md --skills unit-testing',
    description: 'Lancer Sol sur le service API',
    run_in_background: true,
  } as never)

  const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 } }
  const band = await $.ui.mount({ plugin: 'cockpit', component: 'AbovePrompt', surface: 'desktop', props } as never)
  expect((await band.find({ type: 'Text', text: /1 agent/ })) !== undefined).toBe(true)
  await band.unmount()

  const pane = await $.ui.mount({
    plugin: 'cockpit',
    component: 'Pane',
    requestId: 'cockpit',
    surface: 'desktop',
    props: { title: 'Cockpit', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as never)
  expect((await pane.find({ type: 'Text', text: /^sol$/ })) !== undefined).toBe(true)
  expect((await pane.find({ type: 'Text', text: /Lancer Sol sur le service API/ })) !== undefined).toBe(true)
  await pane.unmount()

  const id = asked.filter(a => a.startsWith('tool ')).pop()?.slice(5) ?? ''
  await $.prompt.submit({
    text: `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n</task-notification>`,
    wait: false,
  } as never)

  const after = await $.ui.mount({ plugin: 'cockpit', component: 'AbovePrompt', surface: 'desktop', props } as never)
  expect((await after.find({ type: 'Text', text: /agent/ })) === undefined).toBe(true)
  await after.unmount()
})
