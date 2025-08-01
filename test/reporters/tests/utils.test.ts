import type { ModuleRunner } from 'vite/module-runner'
import type { Vitest } from 'vitest/node'
/**
 * @format
 */
import { resolve } from 'pathe'
import { describe, expect, test } from 'vitest'
import { DefaultReporter } from '../../../packages/vitest/src/node/reporters/default'
import { createReporters } from '../../../packages/vitest/src/node/reporters/utils'
import TestReporter from '../src/custom-reporter'

const customReporterPath = resolve(import.meta.dirname, '../src/custom-reporter.js')
const fetchModule = {
  import: (id: string) => import(id),
} as ModuleRunner
const ctx = {
  runner: fetchModule,
} as Vitest

describe('Reporter Utils', () => {
  test('passing an empty array returns nothing', async () => {
    const promisedReporters = await createReporters([], ctx)
    expect(promisedReporters).toHaveLength(0)
  })

  test('passing the name of a single built-in reporter returns a new instance', async () => {
    const promisedReporters = await createReporters([['default', {}]], ctx)
    expect(promisedReporters).toHaveLength(1)
    const reporter = promisedReporters[0]
    expect(reporter).toBeInstanceOf(DefaultReporter)
  })

  test('passing in the path to a custom reporter returns a new instance', async () => {
    const promisedReporters = await createReporters(([[customReporterPath, {}]]), ctx)
    expect(promisedReporters).toHaveLength(1)
    const customReporter = promisedReporters[0]
    expect(customReporter).toBeInstanceOf(TestReporter)
  })

  test('passing in a mix of built-in and custom reporters works', async () => {
    const promisedReporters = await createReporters([['default', {}], [customReporterPath, {}]], ctx)
    expect(promisedReporters).toHaveLength(2)
    const defaultReporter = promisedReporters[0]
    expect(defaultReporter).toBeInstanceOf(DefaultReporter)
    const customReporter = promisedReporters[1]
    expect(customReporter).toBeInstanceOf(TestReporter)
  })
})
