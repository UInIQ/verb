/*!
 * verb <https://github.com/assemble/verb>
 *
 * Copyright (c) 2014-2015, Jon Schlinkert.
 * Licensed under the MIT license.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var vfs = require('vinyl-fs');
var es = require('event-stream');
var load = require('load-plugins');
var debug = require('debug')('verb');
var Template = require('template');
var tutil = require('template-utils');
var Config = require('orchestrator');
var session = require('./lib/session');
var stack = require('./lib/stack');
var utils = require('./lib/utils');
var _ = require('lodash');
var extend = _.extend;

/**
 * Create an instance of `Verb` with the given `options`.
 *
 * ```js
 * var verb = new Verb();
 * ```
 *
 * @param {Object} `options`
 * @constructor
 */

var Verb = module.exports = Template.extend({
  constructor: function (options) {
    Verb.__super__.constructor.call(this, options);
    Config.call(this);
    this._initialize();
    this.session = session;
  }
});

extend(Verb.prototype, Config.prototype);

/**
 * Initialize all configuration settings.
 *
 * @api private
 */

Verb.prototype._initialize = function() {
  this.fns = {};

  // load extensions first
  this.loadPlugins();
  this.loadHelpers();

  // load all defaults
  this._defaultSettings();
  this._defaultConfig();
  this._defaultTransforms();
  this._defaultDelims();
  this._defaultRoutes();
  this._defaultTemplates();
  this._defaultHelpers();
  this._defaultAsyncHelpers();

};

/**
 * Initialize default template types
 *
 * @api private
 */

Verb.prototype._defaultConfig = function() {
  this.option('delims', ['{%', '%}']);
  this.option('layoutDelims', ['<<%', '%>>']);
  this.option('escapeDelims', {
    from: ['{%%', '%}'],
    to: ['{%', '%}']
  });

  this.option('base', process.cwd());
  this.option('cwd', process.cwd());
  this.option('viewEngine', '.md');
  this.option('destExt', '.md');
  this.option('defaults', {
    isRenderable: true,
    isPartial: true,
    engine: '.md',
    ext: '.md'
  });
};

/**
 * Initialize default template types
 *
 * @api private
 */

Verb.prototype._defaultSettings = function() {
  this.enable('debug');
  this.enable('silent');
  this.disable('debugEngine');

  this.enable('src:init plugin');
  this.enable('dest:render plugin');
  this.enable('dest:readme plugin');
  this.disable('travis badge');
};

/**
 * Load default transforms. Transforms are used to extend or
 * modify the `cache.data` object, but really anything on the
 * `this` object can be tranformed.
 *
 * @api private
 */

Verb.prototype._defaultTransforms = function() {
  this.transform('pkg', require('./lib/transforms/pkg'));
  this.transform('nickname', require('./lib/transforms/nickname'));
  this.transform('username', require('./lib/transforms/username'));
  this.transform('author', require('./lib/transforms/author'));
  this.transform('runner', require('./lib/transforms/runner'));
  this.transform('travis-link', require('./lib/transforms/travis'));
  this.transform('year', require('./lib/transforms/year'));
};

/**
 * Load default routes / middleware
 *
 *   - `.md`: parse front matter in markdown files
 *   - `.hbs`: parse front matter in handlebars templates
 *
 * @api private
 */

Verb.prototype._defaultRoutes = function() {
  // protect escaped templates
  this.route(/\.*/).before(tutil.escape.escape(this));
  this.route(/\.*/).after(tutil.escape.unescape(this));

  // run middlewares to extend the context
  this.onLoad(/\.*/, tutil.parallel([
    require('./lib/middleware/matter'),
    require('./lib/middleware/data'),
    require('./lib/middleware/ext')
  ]));
};

/**
 * Register default template delimiters.
 *
 *   - `['{%', '%}']` => default template delimiters
 *   - `['<<%', '%>>']` => default template delimiters
 *
 * @api private
 */

Verb.prototype._defaultDelims = function() {
  this.addDelims('md', ['{%', '%}'], ['<<%', '%>>']);
};

/**
 * Initialize default template types
 *
 * @api private
 */

Verb.prototype._defaultTemplates = function() {
  var opts = this.option('defaults');

  var create = require('./lib/create/base')(this, opts);
  create('include', require('verb-readme-includes'));
  create('badge', require('verb-readme-badges'));
  create('doc', process.cwd());

  this.create('comment', opts);
  this.create('file', extend(opts, {
    renameKey: function (fp) {
      return fp;
    }
  }));
};

/**
 * Initialize default helpers.
 *
 * @api private
 */

Verb.prototype._defaultHelpers = function() {
  this.helper('date', require('helper-date'));
  this.helper('license', require('helper-license'));
  this.helper('copyright', require('helper-copyright'));
  this.helper('strip', require('./lib/helpers/strip'));
  this.helper('read', function (fp) {
    return fs.readFileSync(fp, 'utf8');
  });
  this.helpers(require('./lib/helpers/deprecated'));
  this.helpers(require('logging-helpers'));
};

/**
 * Initialize async helpers.
 *
 * @api private
 */

Verb.prototype._defaultAsyncHelpers = function() {
  this.asyncHelper('apidocs', require('helper-apidocs'));
  this.asyncHelper('comments', require('helper-apidocs'));
  this.asyncHelper('include', require('./lib/helpers/include')(this));
  this.asyncHelper('badge', require('./lib/helpers/badge')(this));
  this.asyncHelper('docs', require('./lib/helpers/docs')(this));
};

/**
 * Load plugins. Called in the constructor to load plugins from
 * `node_modules` using the given `namespace`. You may also call
 * the method directly.
 *
 * **Example**
 *
 * The namespace `helper` will load plugins using the `helper-*` glob pattern,
 * whilst also stripping the `helper-` part from the name of each helper. In
 * other words, assuming we have a helper named `helper-lowercase`:
 *
 * ```js
 * verb.loadPlugins('helper-*');
 * //=> {lowercase: [function]}
 * ```
 *
 * @param  {String} `pattern` Optionally pass a glob pattern when calling the method directly.
 * @return {Object} Returns an object of plugins loaded from `node_modules`.
 * @api private
 */

Verb.prototype.loadPlugins = function() {
  this.loadType('async-helper', 'async');
  this.loadType('helper', 'helpers');
};

/**
 * Register helpers that are automatically loaded.
 *
 * @api private
 */

Verb.prototype.loadHelpers = function() {
  debug('loading helpers: %j', arguments);
  var name;

  var helpers = Object.keys(this.fns.helpers);
  var len = helpers.length;
  var i = 0;

  while (i < len) {
    name = helpers[i++];
    this.helper(name, this.fns.helpers[name]);
  }

  var async = Object.keys(this.fns.async);
  var alen = async.length;
  var j = 0;

  while (j < alen) {
    name = async[j++];
    this.asyncHelper(name, this.fns.async[name]);
  }

  return this;
};

/**
 * Private method to create a plugin loader for the
 * given plugin `type`, e.g. "helper"
 *
 * @param  {String} `type` The plugin type, e.g. "helper"
 * @param  {String} `collection` Plural form of `type`, e.g. "helpers"
 * @return {Object} `fns` Object of plugins, key-value pairs. The value is a function.
 * @api private
 */

Verb.prototype.loadType = function(type, collection) {
  debug('loading type: %s', type);

  this.fns[collection] = this.fns[collection] || {};
  extend(this.fns[collection], load(type + '*', {
    strip: type,
    cwd: process.cwd()
  }));

  return this.fns[collection];
};

/**
 * Convenience method for looking up a template
 * on the cache by:
 *
 *   1. `name`, as-is
 *   2. If `name` has an extension, try without it
 *   3. If `name` does not have an extension, try `name.md`
 *
 * @param {String} `collection` The collection to search.
 * @param {String} `name` The name of the template.
 * @api private
 */

Verb.prototype.lookup = function(collection, name) {
  debug('lookup [collection]: %s, [name]: %s', collection, name);

  var base = path.basename(name, path.extname(name));
  var views = this.views[collection];

  var ext = this.option('ext');
  if (ext[0] !== '.') {
    ext = '.' + ext;
  }

  if (views.hasOwnProperty(name)) {
    debug('lookup name: %s', name);
    return views[name];
  }

  if (/\./.test(name) && views.hasOwnProperty(base)) {
    debug('lookup base: %s', base);
    return views[base];
  }

  if (views.hasOwnProperty(name + ext)) {
    debug('lookup name + ext: %s', name + ext);
    return views[name + ext];
  }

  return null;
};

/**
 * Run an array of tasks.
 *
 * ```js
 * verb.run(['foo', 'bar']);
 * ```
 *
 * @param {Array} `tasks`
 * @api private
 */

Verb.prototype.run = function () {
  var tasks = arguments.length
    ? arguments :
    ['default'];

  this.start.apply(this, tasks);
};

/**
 * Wrapper around Config._runTask to enable `sessions`
 *
 * @param  {Object} `task` Task to run
 * @api private
 */

Verb.prototype._runTask = function(task) {
  var verb = this;
  session.run(function () {
    session.set('task_name', task.name);
    Config.prototype._runTask.call(verb, task);
  });
};

/**
 * Glob patterns or filepaths to source files.
 *
 * ```js
 * verb.src('src/*.hbs', {layout: 'default'})
 * ```
 *
 * **Example usage**
 *
 * ```js
 * verb.task('site', function() {
 *   verb.src('src/*.hbs', {layout: 'default'})
 *     verb.dest('dist')
 * });
 * ```
 *
 * @param {String|Array} `glob` Glob patterns or file paths to source files.
 * @param {Object} `options` Options or locals to merge into the context and/or pass to `src` plugins
 * @api public
 */

Verb.prototype.src = function (glob, options) {
  return es.pipe.apply(es, utils.arrayify([
    vfs.src(glob, options),
    stack.src(this, glob, options)
  ]));
};

/**
 * Specify a destination for processed files.
 *
 * ```js
 * verb.dest('dist', {ext: '.xml'})
 * ```
 *
 * **Example usage**
 *
 * ```js
 * verb.task('sitemap', function() {
 *   verb.src('src/*.txt')
 *     verb.dest('dist', {ext: '.xml'})
 * });
 * ```
 *
 * @param {String|Function} `dest` File path or rename function.
 * @param {Object} `options` Options or locals to merge into the context and/or pass to `dest` plugins
 * @api public
 */

Verb.prototype.dest = function (dest, options) {
  return es.pipe.apply(es, utils.arrayify([
    stack.dest(this, dest, options),
    vfs.dest(dest, options)
  ]));
};

/**
 * Define a Verb task.
 *
 * ```js
 * verb.task('docs', function() {
 *   verb.src(['.verb.md', 'docs/*.md'])
 *     .pipe(verb.dest('./'));
 * });
 * ```
 *
 * @param {String} `name`
 * @param {Function} `fn`
 * @api public
 */

Verb.prototype.task = Verb.prototype.add;

/**
 * Re-run the specified task(s) when a file changes.
 *
 * ```js
 * verb.task('watch', function() {
 *   verb.watch('docs/*.md', ['docs']);
 * });
 * ```
 *
 * @param  {String|Array} `glob` Filepaths or glob patterns.
 * @param  {Function} `fn` Task(s) to watch.
 * @api public
 */

Verb.prototype.watch = function (glob, opts, fn) {
  if (Array.isArray(opts) || typeof opts === 'function') {
    fn = opts;
    opts = null;
  }

  if (Array.isArray(fn)) {
    return vfs.watch(glob, opts, function () {
      this.start.apply(this, fn);
    }.bind(this));
  }
  return vfs.watch(glob, opts, fn);
};

/**
 * Session-context-specific `files` property that returns
 * the `files` from the current task as a collection.
 *
 * When used in a plugin, the stream must be bound to the
 * session via `session.bindEmitter`:
 *
 * ```js
 * var stream = through.obj(...);
 * verb.session.bindEmitter(stream);
 * return stream;
 * ```
 *
 * @return {Object} `files` Collection from current task.
 * @api public
 */

Object.defineProperty(Verb.prototype, 'files', {
  enumerable: true,
  configurable: true,
  get: function () {
    var name = this.session.get('task_name');
    var type = name
      ? 'task_' + name
      : 'page';

    var collection = this.collection[type];
    return this.views[collection] || {};
  }
});

/**
 * Expose `verb.Verb`
 */

Verb.prototype.Verb = Verb;

/**
 * Expose `verb`
 */

module.exports = new Verb();
