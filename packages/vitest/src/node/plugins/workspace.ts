import type { UserConfig as ViteConfig, Plugin as VitePlugin } from 'vite'
import type { TestProject } from '../project'
import type { ResolvedConfig, TestProjectInlineConfiguration } from '../types/config'
import { existsSync, readFileSync } from 'node:fs'
import { deepMerge } from '@vitest/utils'
import { basename, dirname, relative, resolve } from 'pathe'
import { mergeConfig } from 'vite'
import { configDefaults } from '../../defaults'
import { generateScopedClassName } from '../../integrations/css/css-modules'
import { VitestFilteredOutProjectError } from '../errors'
import { createViteLogger, silenceImportViteIgnoreWarning } from '../viteLogger'
import { CoverageTransform } from './coverageTransform'
import { CSSEnablerPlugin } from './cssEnabler'
import { MocksPlugins } from './mocks'
import { NormalizeURLPlugin } from './normalizeURL'
import { VitestOptimizer } from './optimizer'
import { SsrReplacerPlugin } from './ssrReplacer'
import {
  deleteDefineConfig,
  getDefaultResolveOptions,
  resolveFsAllow,
} from './utils'
import { VitestProjectResolver } from './vitestResolver'

interface WorkspaceOptions extends TestProjectInlineConfiguration {
  root?: string
  workspacePath: string | number
}

export function WorkspaceVitestPlugin(
  project: TestProject,
  options: WorkspaceOptions,
) {
  return <VitePlugin[]>[
    {
      name: 'vitest:project',
      enforce: 'pre',
      options() {
        this.meta.watchMode = false
      },
      config(viteConfig) {
        const defines: Record<string, any> = deleteDefineConfig(viteConfig)

        const testConfig = viteConfig.test || {}

        const root = testConfig.root || viteConfig.root || options.root
        let name = testConfig.name
        if (!name) {
          if (typeof options.workspacePath === 'string') {
            // if there is a package.json, read the name from it
            const dir = options.workspacePath.endsWith('/')
              ? options.workspacePath.slice(0, -1)
              : dirname(options.workspacePath)
            const pkgJsonPath = resolve(dir, 'package.json')
            if (existsSync(pkgJsonPath)) {
              name = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')).name
            }
            if (typeof name !== 'string' || !name) {
              name = basename(dir)
            }
          }
          else {
            name = options.workspacePath.toString()
          }
        }

        const resolveOptions = getDefaultResolveOptions()
        const config: ViteConfig = {
          root,
          define: {
            // disable replacing `process.env.NODE_ENV` with static string by vite:client-inject
            'process.env.NODE_ENV': 'process.env.NODE_ENV',
          },
          resolve: {
            ...resolveOptions,
            alias: testConfig.alias,
          },
          esbuild: viteConfig.esbuild === false
            ? false
            : {
                // Lowest target Vitest supports is Node18
                target: viteConfig.esbuild?.target || 'node18',
                sourcemap: 'external',
                // Enables using ignore hint for coverage providers with @preserve keyword
                legalComments: 'inline',
              },
          server: {
            // disable watch mode in workspaces,
            // because it is handled by the top-level watcher
            watch: null,
            open: false,
            hmr: false,
            ws: false,
            preTransformRequests: false,
            middlewareMode: true,
            fs: {
              allow: resolveFsAllow(
                project.vitest.config.root,
                project.vitest.vite.config.configFile,
              ),
            },
          },
          // eslint-disable-next-line ts/ban-ts-comment
          // @ts-ignore Vite 6 compat
          environments: {
            ssr: {
              resolve: resolveOptions,
            },
          },
          test: {
            name,
          },
        }

        // if this project defines a browser configuration, respect --browser flag
        // otherwise if we always override the configuration, every project will run in browser mode
        if (project.vitest._options.browser && viteConfig.test?.browser) {
          viteConfig.test.browser = mergeConfig(
            viteConfig.test.browser,
            project.vitest._options.browser,
          )
        }

        (config.test as ResolvedConfig).defines = defines

        // keep project names to potentially filter it out
        const workspaceNames = [name]
        if (viteConfig.test?.browser?.enabled) {
          if (viteConfig.test.browser.name && !viteConfig.test.browser.instances?.length) {
            const browser = viteConfig.test.browser.name
            // vitest injects `instances` in this case later on
            workspaceNames.push(name ? `${name} (${browser})` : browser)
          }

          viteConfig.test.browser.instances?.forEach((instance) => {
            // every instance is a potential project
            instance.name ??= name ? `${name} (${instance.browser})` : instance.browser
            workspaceNames.push(instance.name)
          })
        }

        const filters = project.vitest.config.project
        // if there is `--project=...` filter, check if any of the potential projects match
        // if projects don't match, we ignore the test project altogether
        // if some of them match, they will later be filtered again by `resolveWorkspace`
        if (filters.length) {
          const hasProject = workspaceNames.some((name) => {
            return project.vitest.matchesProjectFilter(name)
          })
          if (!hasProject) {
            throw new VitestFilteredOutProjectError()
          }
        }

        const classNameStrategy
          = (typeof testConfig.css !== 'boolean'
            && testConfig.css?.modules?.classNameStrategy)
          || 'stable'

        if (classNameStrategy !== 'scoped') {
          config.css ??= {}
          config.css.modules ??= {}
          if (config.css.modules) {
            config.css.modules.generateScopedName = (
              name: string,
              filename: string,
            ) => {
              const root = project.config.root
              return generateScopedClassName(
                classNameStrategy,
                name,
                relative(root, filename),
              )!
            }
          }
        }
        config.customLogger = createViteLogger(
          project.vitest.logger,
          viteConfig.logLevel || 'warn',
          {
            allowClearScreen: false,
          },
        )
        config.customLogger = silenceImportViteIgnoreWarning(config.customLogger)

        return config
      },
      async configureServer(server) {
        const options = deepMerge({}, configDefaults, server.config.test || {})
        await project._configureServer(options, server)

        await server.watcher.close()
      },
    },
    SsrReplacerPlugin(),
    ...CSSEnablerPlugin(project),
    CoverageTransform(project.ctx),
    ...MocksPlugins(),
    VitestProjectResolver(project.ctx),
    VitestOptimizer(),
    NormalizeURLPlugin(),
  ]
}
