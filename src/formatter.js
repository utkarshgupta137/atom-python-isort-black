const { CompositeDisposable } = require("atom");
const isValidPath = require("is-valid-path");
const _ = require("lodash");
const untildify = require("untildify");

const config = require("./config.js");
const helpers = require("./helpers.js");

class Formatter {
  constructor(name) {
    this.name = name;
    this.subscriptions = new CompositeDisposable();

    this.subscriptions.add(
      config.observe.call(this, `${name}.local.bins`, this.setLocalBins),
      config.observe.call(this, `${name}.local.cmdArgs`, this.setLocalCmdArgs),
      config.observe.call(this, `${name}.local.configs`, this.setLocalConfigs),
      config.observe.call(
        this,
        `${name}.global.binPath`,
        this.setGlobalBinPath
      ),
      config.observe.call(
        this,
        `${name}.global.cmdArgs`,
        this.setGlobalCmdArgs
      ),
      config.observe.call(
        this,
        `${name}.global.configs`,
        this.setGlobalConfigs
      ),
      config.addCommand(name, () => {
        this.format(atom.workspace.getActiveTextEditor(), true);
      })
    );
  }

  getLocalBinPath = _.memoize(
    (filePath) => {
      let binPath;
      this.localBins.some((binPathName) => {
        binPath = helpers.findFileInRepo(filePath, binPathName, true);
        if (binPath) {
          return true;
        }
        return false;
      });
      return binPath || "";
    },
    (...args) => {
      return _.values(args).join(",");
    }
  );

  setLocalBins = (value) => {
    const localBins = _.compact(value);
    if (_.isEqual(localBins, this.localBins)) {
      return;
    }

    this.getLocalBinPath.cache.clear();
    this.localBins = localBins;
    if (
      this.localBins.some((name) => {
        if (isValidPath(name)) {
          return false;
        }
        helpers.handleError(
          `'${name}' is not a valid file name.`,
          `Invalid local binary path for ${this.name}`
        );
        return true;
      })
    ) {
      this.localBins = [];
    }
  };

  setGlobalBinPath = (value) => {
    const binPath = untildify(value.trim());
    if (binPath === this.binPath) {
      return;
    }

    if (!binPath) {
      this.binPath = "";
      return;
    }
    if (helpers.isPathX(binPath)) {
      this.binPath = binPath;
    } else {
      helpers.handleError(
        `'${binPath}' not found or not executable.`,
        `Invalid global binary path for ${this.name}`
      );
      this.binPath = "";
    }
  };

  getCmdArgs = _.memoize(
    (filePath, configPath, buffer) => {
      const args = [];
      args.push(config.getDefaultArgs(this.name, buffer));

      if (configPath) {
        args.push(config.getConfigArgs(this.name), configPath);
      }

      if (buffer) {
        args.push("-");
      } else {
        args.push(`"${filePath}"`);
      }
      return args;
    },
    (...args) => {
      return _.values(args).join(",");
    }
  );

  getLocalCmdArgs = (filePath, buffer) => {
    const configPath = this.getLocalConfigPath(filePath);
    return this.localCmdArgs.concat(
      this.getCmdArgs(filePath, configPath, buffer)
    );
  };

  getGlobalCmdArgs = (filePath, buffer) => {
    const configPath = this.getGlobalConfigPath(filePath);
    return this.globalCmdArgs.concat(
      this.getCmdArgs(filePath, configPath, buffer)
    );
  };

  setLocalCmdArgs = (value) => {
    this.localCmdArgs = value || [];
  };

  setGlobalCmdArgs = (value) => {
    this.globalCmdArgs = value || [];
  };

  getConfigPath = (filePath, configs) => {
    let configPath;
    configs.some((configFileName) => {
      if (configFileName.startsWith("/") || configFileName.startsWith("~")) {
        configPath = untildify(configFileName.trim());
      } else {
        configPath = helpers.findFileInRepo(filePath, configFileName);
      }
      if (configPath) {
        return true;
      }
      return false;
    });
    return configPath || "";
  };

  getLocalConfigPath = _.memoize(
    (filePath) => {
      return this.getConfigPath(filePath, this.localConfigs);
    },
    (...args) => {
      return _.values(args).join(",");
    }
  );

  getGlobalConfigPath = _.memoize(
    (filePath) => {
      return this.getConfigPath(filePath, this.globalConfigs);
    },
    (...args) => {
      return _.values(args).join(",");
    }
  );

  isConfigsValid = (configs) => {
    return configs.every((name) => {
      if (name.startsWith("/") || name.startsWith("~")) {
        const globalConfig = untildify(name.trim());
        if (helpers.isPathR(globalConfig)) {
          return true;
        }
        helpers.handleError(
          `'${globalConfig}' not found or not readable.`,
          `Invalid global config path for ${this.name}`
        );
        return false;
      }
      if (isValidPath(name)) {
        return true;
      }
      helpers.handleError(
        `'${name}' is not a valid file name.`,
        `Invalid local configs for ${this.name}`
      );
      return false;
    });
  };

  setLocalConfigs = (value) => {
    const configs = _.compact(value);
    if (_.isEqual(configs, this.localConfigs)) {
      return;
    }

    this.getLocalConfigPath.cache.clear();
    this.localConfigs = [];
    if (this.isConfigsValid(configs)) {
      this.localConfigs = configs;
    }
  };

  setGlobalConfigs = (value) => {
    const configs = _.compact(value);
    if (_.isEqual(configs, this.globalConfigs)) {
      return;
    }

    this.getGlobalConfigPath.cache.clear();
    this.globalConfigs = [];
    if (this.isConfigsValid(configs)) {
      this.globalConfigs = configs;
    }
  };

  format(editor, buffer, next = () => {}) {
    const filePath = editor.getPath();
    const localBinPath = this.getLocalBinPath(filePath);
    if (localBinPath) {
      helpers.spawn(
        editor,
        localBinPath,
        this.getLocalCmdArgs(filePath, buffer),
        buffer,
        next
      );
    } else if (this.binPath) {
      helpers.spawn(
        editor,
        this.binPath,
        this.getGlobalCmdArgs(filePath, buffer),
        buffer,
        next
      );
    } else {
      helpers.handleError(null, `Could not find binary for ${this.name}`);
      next();
    }
  }
}

module.exports = { Formatter };
