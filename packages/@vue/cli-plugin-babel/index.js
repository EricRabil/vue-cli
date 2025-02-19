const path = require('path')
const babel = require('@babel/core')
const { isWindows } = require('@vue/cli-shared-utils')

function genTranspileDepRegex (transpileDependencies) {
  const deps = transpileDependencies.map(dep => {
    if (typeof dep === 'string') {
      const depPath = path.join('node_modules', dep, '/')
      return isWindows
        ? depPath.replace(/\\/g, '\\\\') // double escape for windows style path
        : depPath
    } else if (dep instanceof RegExp) {
      return dep.source
    }

    throw new Error('transpileDependencies only accepts an array of string or regular expressions')
  })
  return deps.length ? new RegExp(deps.join('|')) : null
}

/** @type {import('@vue/cli-service').ServicePlugin} */
module.exports = (api, options) => {
  const useThreads = process.env.NODE_ENV === 'production' && !!options.parallel
  const cliServicePath = path.dirname(require.resolve('@vue/cli-service'))
  const transpileDepRegex = genTranspileDepRegex(options.transpileDependencies)

  // try to load the project babel config;
  // if the default preset is used,
  // there will be a VUE_CLI_TRANSPILE_BABEL_RUNTIME env var set.
  // the `filename` field is required
  // in case there're filename-related options like `ignore` in the user config
  babel.loadPartialConfigSync({ filename: api.resolve('src/main.js') })

  api.chainWebpack(webpackConfig => {
    webpackConfig.resolveLoader.modules.prepend(path.join(__dirname, 'node_modules'))

    const jsRule = webpackConfig.module
      .rule('js')
        .test(/\.m?jsx?$/)
        .exclude
          .add(filepath => {
            // always transpile js in vue files
            if (/\.vue\.jsx?$/.test(filepath)) {
              return false
            }
            // exclude dynamic entries from cli-service
            if (filepath.startsWith(cliServicePath)) {
              return true
            }

            // only include @babel/runtime when the @vue/babel-preset-app preset is used
            if (
              process.env.VUE_CLI_TRANSPILE_BABEL_RUNTIME &&
              filepath.includes(path.join('@babel', 'runtime'))
            ) {
              return false
            }

            // check if this is something the user explicitly wants to transpile
            if (transpileDepRegex && transpileDepRegex.test(filepath)) {
              return false
            }
            // Don't transpile node_modules
            return /node_modules/.test(filepath)
          })
          .end()

    if (useThreads) {
      const threadLoaderConfig = jsRule
        .use('thread-loader')
          .loader(require.resolve('thread-loader'))

      if (typeof options.parallel === 'number') {
        threadLoaderConfig.options({ workers: options.parallel })
      }
    }

    jsRule
      .use('babel-loader')
        .loader(require.resolve('babel-loader'))
        .options(api.genCacheConfig('babel-loader', {
          '@babel/core': require('@babel/core/package.json').version,
          '@vue/babel-preset-app': require('@vue/babel-preset-app/package.json').version,
          'babel-loader': require('babel-loader/package.json').version,
          modern: !!process.env.VUE_CLI_MODERN_BUILD,
          browserslist: api.service.pkg.browserslist
        }, [
          'babel.config.js',
          '.browserslistrc'
        ]))
  })
}
