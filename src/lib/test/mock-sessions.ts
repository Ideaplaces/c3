import type { ServerMessage } from '@/types/ws'

function sdkEvent(sessionId: string, message: unknown): ServerMessage {
  return { type: 'sdk_event', sessionId, message } as ServerMessage
}

function userText(sid: string, text: string): ServerMessage {
  return sdkEvent(sid, { type: 'user', message: { role: 'user', content: text } })
}

function assistantText(sid: string, text: string): ServerMessage {
  return sdkEvent(sid, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
}

function toolCall(sid: string, name: string, id: string, input: Record<string, unknown>): ServerMessage {
  return sdkEvent(sid, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
}

function toolResult(sid: string, toolId: string, content: string, isError = false): ServerMessage {
  return sdkEvent(sid, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content, is_error: isError }] } })
}

function systemInit(sid: string, cwd: string): ServerMessage {
  return sdkEvent(sid, { type: 'system', subtype: 'init', cwd, model: 'claude-sonnet-4-6', permissionMode: 'bypassPermissions', tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'] })
}

function sessionStarted(sid: string): ServerMessage {
  return { type: 'session_started', sessionId: sid } as ServerMessage
}

function sessionEnded(sid: string): ServerMessage {
  return { type: 'session_ended', sessionId: sid, reason: 'completed' } as ServerMessage
}

const SID = 'mock-session-001'

// Scenario 1: Empty session (no messages, completed)
export const emptySession: ServerMessage[] = [
  sessionStarted(SID),
  sessionEnded(SID),
]

// Scenario 2: Short conversation (2 turns)
export const shortSession: ServerMessage[] = [
  sessionStarted(SID),
  systemInit(SID, '/home/dev/my-project'),
  userText(SID, 'What does the main function do?'),
  assistantText(SID, 'The main function initializes the Express server, sets up middleware for CORS and JSON parsing, registers all API routes, and starts listening on port 3000. It also handles graceful shutdown on SIGTERM.'),
  sessionEnded(SID),
]

// Scenario 3: Session with tool calls
export const toolSession: ServerMessage[] = [
  sessionStarted(SID),
  systemInit(SID, '/home/dev/my-project'),
  userText(SID, 'Fix the failing test in auth.test.ts'),
  toolCall(SID, 'Read', 't1', { file_path: '/home/dev/my-project/tests/auth.test.ts' }),
  toolResult(SID, 't1', `import { authenticate } from '../src/auth'\n\ndescribe('authenticate', () => {\n  it('should return user for valid token', () => {\n    const result = authenticate('valid-token')\n    expect(result).toEqual({ id: 1, email: 'test@test.com' })\n  })\n\n  it('should throw for expired token', () => {\n    expect(() => authenticate('expired')).toThrow('Token expired')\n  })\n})`),
  toolCall(SID, 'Read', 't2', { file_path: '/home/dev/my-project/src/auth.ts' }),
  toolResult(SID, 't2', `import jwt from 'jsonwebtoken'\n\nexport function authenticate(token: string) {\n  const decoded = jwt.verify(token, process.env.JWT_SECRET!)\n  return decoded as { id: number; email: string }\n}`),
  toolCall(SID, 'Bash', 't3', { command: 'cd /home/dev/my-project && npm test -- --testPathPattern auth 2>&1' }),
  toolResult(SID, 't3', 'FAIL tests/auth.test.ts\n  authenticate\n    ✓ should return user for valid token (3ms)\n    ✗ should throw for expired token (5ms)\n\n  ● authenticate > should throw for expired token\n    Expected: "Token expired"\n    Received: "jwt expired"\n\nTests: 1 failed, 1 passed, 2 total'),
  assistantText(SID, 'The test expects the error message "Token expired" but `jsonwebtoken` throws "jwt expired". I\'ll update the auth module to catch and rethrow with the expected message.'),
  toolCall(SID, 'Edit', 't4', { file_path: '/home/dev/my-project/src/auth.ts', old_string: 'const decoded = jwt.verify(token, process.env.JWT_SECRET!)', new_string: 'try {\n    const decoded = jwt.verify(token, process.env.JWT_SECRET!)\n    return decoded as { id: number; email: string }\n  } catch (err: any) {\n    if (err.name === \'TokenExpiredError\') throw new Error(\'Token expired\')\n    throw err\n  }' }),
  toolResult(SID, 't4', 'File edited successfully'),
  toolCall(SID, 'Bash', 't5', { command: 'cd /home/dev/my-project && npm test -- --testPathPattern auth 2>&1' }),
  toolResult(SID, 't5', 'PASS tests/auth.test.ts\n  authenticate\n    ✓ should return user for valid token (2ms)\n    ✓ should throw for expired token (1ms)\n\nTests: 2 passed, 2 total'),
  assistantText(SID, 'Fixed. The issue was that `jsonwebtoken` throws "jwt expired" but the test expected "Token expired". I wrapped the verify call in a try/catch that translates the error message. Both tests pass now.'),
  sessionEnded(SID),
]

// Scenario 4: Long conversation (many turns to test scrolling)
export const longSession: ServerMessage[] = (() => {
  const msgs: ServerMessage[] = [
    sessionStarted(SID),
    systemInit(SID, '/home/dev/e-commerce'),
    userText(SID, 'I need to add a discount code feature to the checkout. Users should be able to enter a code and get a percentage off their order total.'),
  ]

  // Simulate a long investigation with many tool calls
  const files = [
    'src/routes/checkout.ts', 'src/models/order.ts', 'src/models/discount.ts',
    'src/services/pricing.ts', 'src/middleware/validation.ts', 'tests/checkout.test.ts',
    'src/routes/admin.ts', 'src/db/migrations/003_discounts.sql',
  ]

  msgs.push(assistantText(SID, 'I\'ll implement a discount code feature. Let me first understand the existing checkout flow and data models.'))

  for (let i = 0; i < files.length; i++) {
    const tid = `read-${i}`
    msgs.push(toolCall(SID, 'Read', tid, { file_path: `/home/dev/e-commerce/${files[i]}` }))
    msgs.push(toolResult(SID, tid, `// Contents of ${files[i]}\n// ... (${50 + i * 20} lines of code)\nexport function process() { /* ... */ }`))
  }

  msgs.push(assistantText(SID, 'I\'ve reviewed the codebase. Here\'s my plan:\n\n1. Create a `discounts` table with columns: code, percentage, active, expires_at\n2. Add a `DiscountCode` model\n3. Add a `POST /checkout/apply-discount` endpoint\n4. Update the pricing service to apply discounts\n5. Add validation middleware\n6. Write tests\n\nLet me start with the migration.'))

  // Create migration
  msgs.push(toolCall(SID, 'Write', 'w1', { file_path: '/home/dev/e-commerce/src/db/migrations/004_discount_codes.sql' }))
  msgs.push(toolResult(SID, 'w1', 'File written successfully'))

  // Create model
  msgs.push(toolCall(SID, 'Write', 'w2', { file_path: '/home/dev/e-commerce/src/models/discount-code.ts' }))
  msgs.push(toolResult(SID, 'w2', 'File written successfully'))

  // Update pricing service
  msgs.push(toolCall(SID, 'Edit', 'e1', { file_path: '/home/dev/e-commerce/src/services/pricing.ts' }))
  msgs.push(toolResult(SID, 'e1', 'File edited successfully'))

  // Add route
  msgs.push(toolCall(SID, 'Edit', 'e2', { file_path: '/home/dev/e-commerce/src/routes/checkout.ts' }))
  msgs.push(toolResult(SID, 'e2', 'File edited successfully'))

  // Run tests
  msgs.push(toolCall(SID, 'Bash', 'b1', { command: 'npm test 2>&1' }))
  msgs.push(toolResult(SID, 'b1', 'PASS tests/checkout.test.ts\nPASS tests/discount.test.ts\n\nTest Suites: 2 passed, 2 total\nTests: 14 passed, 14 total'))

  msgs.push(assistantText(SID, 'The discount code feature is implemented and all tests pass. Here\'s a summary of changes:\n\n**New files:**\n- `src/db/migrations/004_discount_codes.sql` creates the discounts table\n- `src/models/discount-code.ts` with `findByCode()` and `validate()` methods\n\n**Modified files:**\n- `src/services/pricing.ts` now accepts an optional discount parameter\n- `src/routes/checkout.ts` has a new `POST /checkout/apply-discount` endpoint\n\nThe endpoint validates the code, checks expiration, and returns the updated total. Invalid or expired codes return a 400 with a clear error message.'))

  msgs.push(userText(SID, 'Can you also add a max uses limit per code?'))

  msgs.push(assistantText(SID, 'Sure. I\'ll add a `max_uses` column and a `current_uses` counter to the discounts table, then update the validation logic.'))

  msgs.push(toolCall(SID, 'Edit', 'e3', { file_path: '/home/dev/e-commerce/src/db/migrations/004_discount_codes.sql' }))
  msgs.push(toolResult(SID, 'e3', 'File edited successfully'))
  msgs.push(toolCall(SID, 'Edit', 'e4', { file_path: '/home/dev/e-commerce/src/models/discount-code.ts' }))
  msgs.push(toolResult(SID, 'e4', 'File edited successfully'))
  msgs.push(toolCall(SID, 'Bash', 'b2', { command: 'npm test 2>&1' }))
  msgs.push(toolResult(SID, 'b2', 'PASS tests/checkout.test.ts\nPASS tests/discount.test.ts\n\nTest Suites: 2 passed, 2 total\nTests: 16 passed, 16 total'))

  msgs.push(assistantText(SID, 'Done. Each discount code now has `max_uses` (nullable, null means unlimited) and `current_uses` (starts at 0). The validation checks `current_uses < max_uses` before applying, and increments the counter atomically when used. Two new tests cover the limit enforcement.'))

  msgs.push(sessionEnded(SID))
  return msgs
})()

// Scenario 5: Running session (no session_ended)
export const runningSession: ServerMessage[] = [
  sessionStarted(SID),
  systemInit(SID, '/home/dev/api-server'),
  userText(SID, 'Deploy the latest changes to staging'),
  assistantText(SID, 'I\'ll deploy the latest changes to the staging environment. Let me check the current status first.'),
  toolCall(SID, 'Bash', 't1', { command: 'git status && git log --oneline -5' }),
  toolResult(SID, 't1', 'On branch main\nYour branch is up to date with \'origin/main\'.\n\nnothing to commit, working tree clean\n\na1b2c3d Fix rate limiter bug\ne4f5g6h Add user preferences endpoint\ni7j8k9l Update dependencies\nm0n1o2p Improve error logging\nq3r4s5t Initial commit'),
  // No session_ended = still running
]

// Scenario 6: Error session
export const errorSession: ServerMessage[] = [
  sessionStarted(SID),
  systemInit(SID, '/home/dev/my-project'),
  userText(SID, 'Run the database migration'),
  toolCall(SID, 'Bash', 't1', { command: 'npx prisma migrate deploy 2>&1' }),
  toolResult(SID, 't1', 'Error: P3009\n\nmigrate found failed migrations in the target database, new migrations will not be applied.\n\nThe `20240115_add_users` migration started at 2024-01-15 failed.\n\nTo mark the failed migration as rolled back, run:\nprisma migrate resolve --rolled-back "20240115_add_users"', true),
  assistantText(SID, 'The migration failed because there\'s a previously failed migration blocking new ones. The `20240115_add_users` migration needs to be resolved first. This requires manual intervention since I should not run database migrations directly.\n\nTo fix this:\n1. Run `npx prisma migrate resolve --rolled-back "20240115_add_users"`\n2. Then retry `npx prisma migrate deploy`\n\nI recommend checking the migration file first to understand what failed and whether the partial changes need manual cleanup.'),
  sessionEnded(SID),
]

// Scenario 7: Session with code blocks in assistant response
export const codeSession: ServerMessage[] = [
  sessionStarted(SID),
  systemInit(SID, '/home/dev/react-app'),
  userText(SID, 'Show me how to create a custom React hook for debouncing'),
  assistantText(SID, 'Here\'s a `useDebounce` hook:\n\n```typescript\nimport { useState, useEffect } from \'react\'\n\nexport function useDebounce<T>(value: T, delay: number): T {\n  const [debouncedValue, setDebouncedValue] = useState<T>(value)\n\n  useEffect(() => {\n    const timer = setTimeout(() => {\n      setDebouncedValue(value)\n    }, delay)\n\n    return () => clearTimeout(timer)\n  }, [value, delay])\n\n  return debouncedValue\n}\n```\n\nUsage:\n\n```typescript\nfunction SearchComponent() {\n  const [query, setQuery] = useState(\'\')\n  const debouncedQuery = useDebounce(query, 300)\n\n  useEffect(() => {\n    if (debouncedQuery) {\n      searchAPI(debouncedQuery)\n    }\n  }, [debouncedQuery])\n\n  return <input value={query} onChange={e => setQuery(e.target.value)} />\n}\n```\n\nThe hook delays updating the value until the user stops changing it for the specified duration. This prevents excessive API calls while typing.'),
  sessionEnded(SID),
]

export const ALL_SCENARIOS = {
  'empty': { messages: emptySession, label: 'Empty session' },
  'short': { messages: shortSession, label: 'Short conversation' },
  'tools': { messages: toolSession, label: 'Tool calls (bug fix)' },
  'long': { messages: longSession, label: 'Long conversation' },
  'running': { messages: runningSession, label: 'Running session' },
  'error': { messages: errorSession, label: 'Error scenario' },
  'code': { messages: codeSession, label: 'Code blocks' },
} as const
